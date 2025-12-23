// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint8, euint64, externalEuint8, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Futurify - encrypted prediction market
/// @notice Users buy encrypted coins with ETH, create predictions, and place encrypted bets.
contract Futurify is ZamaEthereumConfig {
    uint256 public constant COINS_PER_ETH = 1_000_000;
    uint256 public predictionCount;

    struct Prediction {
        string title;
        string[] options;
        uint8 optionCount;
        address creator;
        uint64 createdAt;
        bool isOpen;
        euint64[4] optionTotals;
    }

    mapping(address => euint64) private _balances;
    mapping(uint256 => Prediction) private _predictions;
    mapping(uint256 => mapping(address => euint8)) private _userChoices;
    mapping(uint256 => mapping(address => euint64)) private _userBets;

    event CoinsPurchased(address indexed buyer, uint256 ethAmount, uint256 coinAmount);
    event PredictionCreated(uint256 indexed predictionId, address indexed creator, string title, uint8 optionCount);
    event BetPlaced(uint256 indexed predictionId, address indexed user);
    event PredictionEnded(uint256 indexed predictionId, address indexed endedBy);

    error InvalidOptions();
    error PredictionClosed(uint256 predictionId);
    error PredictionNotFound(uint256 predictionId);
    error OnlyCreator();

    /// @notice Buy encrypted coins with ETH at a 1 ETH = 1,000,000 coin rate.
    function buyCoins() external payable {
        require(msg.value > 0, "No ETH sent");

        uint256 coinAmount = (msg.value * COINS_PER_ETH) / 1 ether;
        require(coinAmount <= type(uint64).max, "Amount too large");
        euint64 minted = FHE.asEuint64(uint64(coinAmount));

        _balances[msg.sender] = FHE.add(_balances[msg.sender], minted);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        emit CoinsPurchased(msg.sender, msg.value, coinAmount);
    }

    /// @notice Get encrypted coin balance for a user.
    function getBalance(address user) external view returns (euint64) {
        return _balances[user];
    }

    /// @notice Create a prediction with 2-4 options.
    function createPrediction(string calldata title, string[] calldata options) external returns (uint256 predictionId) {
        uint256 optionsLength = options.length;
        if (optionsLength < 2 || optionsLength > 4) {
            revert InvalidOptions();
        }

        predictionId = predictionCount;
        predictionCount += 1;

        Prediction storage prediction = _predictions[predictionId];
        prediction.title = title;
        prediction.optionCount = uint8(optionsLength);
        prediction.creator = msg.sender;
        prediction.createdAt = uint64(block.timestamp);
        prediction.isOpen = true;

        for (uint256 i = 0; i < optionsLength; i++) {
            prediction.options.push(options[i]);
        }

        for (uint256 i = 0; i < 4; i++) {
            prediction.optionTotals[i] = FHE.asEuint64(0);
            FHE.allowThis(prediction.optionTotals[i]);
            FHE.allow(prediction.optionTotals[i], msg.sender);
        }

        emit PredictionCreated(predictionId, msg.sender, title, uint8(optionsLength));
    }

    /// @notice Get metadata for a prediction without using msg.sender.
    function getPrediction(
        uint256 predictionId
    )
        external
        view
        returns (string memory title, string[] memory options, uint8 optionCount, bool isOpen, uint64 createdAt, address creator)
    {
        Prediction storage prediction = _predictions[predictionId];
        if (prediction.optionCount < 2) {
            revert PredictionNotFound(predictionId);
        }

        return (
            prediction.title,
            prediction.options,
            prediction.optionCount,
            prediction.isOpen,
            prediction.createdAt,
            prediction.creator
        );
    }

    /// @notice Get encrypted totals for all options (up to 4).
    function getPredictionTotals(uint256 predictionId) external view returns (euint64[4] memory) {
        Prediction storage prediction = _predictions[predictionId];
        if (prediction.optionCount < 2) {
            revert PredictionNotFound(predictionId);
        }

        return prediction.optionTotals;
    }

    /// @notice Get a user's encrypted choice for a prediction.
    function getUserChoice(uint256 predictionId, address user) external view returns (euint8) {
        Prediction storage prediction = _predictions[predictionId];
        if (prediction.optionCount < 2) {
            revert PredictionNotFound(predictionId);
        }

        return _userChoices[predictionId][user];
    }

    /// @notice Get a user's encrypted bet amount for a prediction.
    function getUserBet(uint256 predictionId, address user) external view returns (euint64) {
        Prediction storage prediction = _predictions[predictionId];
        if (prediction.optionCount < 2) {
            revert PredictionNotFound(predictionId);
        }

        return _userBets[predictionId][user];
    }

    /// @notice Place an encrypted bet on a prediction.
    function placeBet(
        uint256 predictionId,
        externalEuint8 encryptedChoice,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        Prediction storage prediction = _predictions[predictionId];
        if (prediction.optionCount < 2) {
            revert PredictionNotFound(predictionId);
        }
        if (!prediction.isOpen) {
            revert PredictionClosed(predictionId);
        }

        euint8 choice = FHE.fromExternal(encryptedChoice, inputProof);
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        ebool choiceValid = FHE.lt(choice, prediction.optionCount);
        ebool balanceEnough = FHE.le(amount, _balances[msg.sender]);
        ebool canBet = FHE.and(choiceValid, balanceEnough);

        euint64 spend = FHE.select(canBet, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], spend);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        euint8 storedChoice = FHE.select(canBet, choice, FHE.asEuint8(0));
        _userChoices[predictionId][msg.sender] = storedChoice;
        _userBets[predictionId][msg.sender] = spend;

        FHE.allowThis(_userChoices[predictionId][msg.sender]);
        FHE.allow(_userChoices[predictionId][msg.sender], msg.sender);
        FHE.allowThis(_userBets[predictionId][msg.sender]);
        FHE.allow(_userBets[predictionId][msg.sender], msg.sender);

        for (uint256 i = 0; i < 4; i++) {
            if (i < prediction.optionCount) {
                ebool isChoice = FHE.eq(choice, uint8(i));
                euint64 addAmount = FHE.select(isChoice, spend, FHE.asEuint64(0));
                prediction.optionTotals[i] = FHE.add(prediction.optionTotals[i], addAmount);
                FHE.allowThis(prediction.optionTotals[i]);
                FHE.allow(prediction.optionTotals[i], prediction.creator);
            }
        }

        emit BetPlaced(predictionId, msg.sender);
    }

    /// @notice End a prediction and make totals publicly decryptable.
    function endPrediction(uint256 predictionId) external {
        Prediction storage prediction = _predictions[predictionId];
        if (prediction.optionCount < 2) {
            revert PredictionNotFound(predictionId);
        }
        if (msg.sender != prediction.creator) {
            revert OnlyCreator();
        }
        if (!prediction.isOpen) {
            revert PredictionClosed(predictionId);
        }

        prediction.isOpen = false;

        for (uint256 i = 0; i < prediction.optionCount; i++) {
            FHE.makePubliclyDecryptable(prediction.optionTotals[i]);
        }

        emit PredictionEnded(predictionId, msg.sender);
    }
}
