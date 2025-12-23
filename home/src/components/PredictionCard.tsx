import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { JsonRpcSigner } from 'ethers';
import { Contract, ZeroHash } from 'ethers';
import { useReadContract } from 'wagmi';
import { CONTRACT_ABI, CONTRACT_ADDRESS, type HexAddress } from '../config/contracts';
import '../styles/PredictionCard.css';

export type PredictionMeta = {
  id: number;
  title: string;
  options: readonly string[];
  optionCount: number;
  isOpen: boolean;
  createdAt: number;
  creator: string;
};

type PredictionCardProps = {
  prediction: PredictionMeta;
  address?: HexAddress;
  instance: any;
  signerPromise?: Promise<JsonRpcSigner>;
  onRefresh?: () => void;
};

type DecryptedBet = {
  amount: string;
  choice: number;
};

const DEFAULT_DURATION_DAYS = '10';

export function PredictionCard({ prediction, address, instance, signerPromise, onRefresh }: PredictionCardProps) {
  const [betAmount, setBetAmount] = useState('');
  const [selectedOption, setSelectedOption] = useState('0');
  const [isBetting, setIsBetting] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [myBet, setMyBet] = useState<DecryptedBet | null>(null);
  const [isDecryptingBet, setIsDecryptingBet] = useState(false);
  const [publicTotals, setPublicTotals] = useState<number[] | null>(null);
  const [isDecryptingTotals, setIsDecryptingTotals] = useState(false);

  const { data: encryptedTotals } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getPredictionTotals',
    args: [BigInt(prediction.id)],
  });

  const { data: encryptedChoice } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getUserChoice',
    args: address ? [BigInt(prediction.id), address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const { data: encryptedBet } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getUserBet',
    args: address ? [BigInt(prediction.id), address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const optionLabels = useMemo(
    () => prediction.options.slice(0, prediction.optionCount),
    [prediction.options, prediction.optionCount],
  );

  useEffect(() => {
    if (prediction.isOpen || !instance || !encryptedTotals || publicTotals || isDecryptingTotals) {
      return;
    }

    let mounted = true;
    const run = async () => {
      setIsDecryptingTotals(true);
      try {
        const handles = (encryptedTotals as readonly string[]).slice(0, prediction.optionCount);
        const result = await instance.publicDecrypt(handles);
        if (!mounted) {
          return;
        }
        const totals = handles.map((handle) => {
          const value = result.clearValues?.[handle];
          return value ? Number(value) : 0;
        });
        setPublicTotals(totals);
      } catch (error) {
        if (mounted) {
          setPublicTotals([]);
        }
        console.error('Failed to public decrypt totals:', error);
      } finally {
        if (mounted) {
          setIsDecryptingTotals(false);
        }
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [prediction.isOpen, instance, encryptedTotals, publicTotals, isDecryptingTotals, prediction.optionCount]);

  const handlePlaceBet = async (event: FormEvent) => {
    event.preventDefault();
    setBetError(null);

    if (!address) {
      setBetError('Connect your wallet to place a bet.');
      return;
    }
    if (!instance || !signerPromise) {
      setBetError('Encryption service is still loading.');
      return;
    }

    const amountValue = Number(betAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setBetError('Enter a valid coin amount.');
      return;
    }

    setIsBetting(true);
    try {
      const input = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
      input.add8(Number(selectedOption));
      input.add64(amountValue);
      const encryptedInput = await input.encrypt();

      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.placeBet(
        prediction.id,
        encryptedInput.handles[0],
        encryptedInput.handles[1],
        encryptedInput.inputProof,
      );
      await tx.wait();

      setBetAmount('');
      setMyBet(null);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to place bet:', error);
      setBetError('Bet failed. Please try again.');
    } finally {
      setIsBetting(false);
    }
  };

  const decryptMyBet = async () => {
    if (!address || !instance || !signerPromise || !encryptedBet || !encryptedChoice) {
      return;
    }
    const betHandle = encryptedBet as string;
    const choiceHandle = encryptedChoice as string;

    if (betHandle === ZeroHash || choiceHandle === ZeroHash) {
      setMyBet({ amount: '0', choice: 0 });
      return;
    }

    setIsDecryptingBet(true);
    try {
      const keypair = instance.generateKeypair();
      const handleContractPairs = [
        { handle: betHandle, contractAddress: CONTRACT_ADDRESS },
        { handle: choiceHandle, contractAddress: CONTRACT_ADDRESS },
      ];
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const contractAddresses = [CONTRACT_ADDRESS];

      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        DEFAULT_DURATION_DAYS,
      );

      const signer = await signerPromise;
      const signature = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        DEFAULT_DURATION_DAYS,
      );

      const amount = result[betHandle] ?? '0';
      const choice = Number(result[choiceHandle] ?? 0);
      setMyBet({ amount: amount.toString(), choice });
    } catch (error) {
      console.error('Failed to decrypt bet:', error);
      setBetError('Unable to decrypt your bet.');
    } finally {
      setIsDecryptingBet(false);
    }
  };

  const endPrediction = async () => {
    if (!signerPromise) {
      return;
    }

    setIsBetting(true);
    try {
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.endPrediction(prediction.id);
      await tx.wait();
      onRefresh?.();
    } catch (error) {
      console.error('Failed to end prediction:', error);
      setBetError('Ending the prediction failed.');
    } finally {
      setIsBetting(false);
    }
  };

  const createdLabel = new Date(prediction.createdAt * 1000).toLocaleString();
  const isCreator = address?.toLowerCase() === prediction.creator.toLowerCase();

  return (
    <article className="prediction-card">
      <div className="prediction-card__header">
        <div>
          <p className="prediction-card__label">Prediction #{prediction.id}</p>
          <h3 className="prediction-card__title">{prediction.title}</h3>
        </div>
        <span className={`prediction-card__status ${prediction.isOpen ? 'is-open' : 'is-closed'}`}>
          {prediction.isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      <div className="prediction-card__meta">
        <span>Created {createdLabel}</span>
        <span>Creator {prediction.creator.slice(0, 6)}...{prediction.creator.slice(-4)}</span>
      </div>

      <div className="prediction-card__options">
        {optionLabels.map((option, index) => (
          <div className="prediction-card__option" key={`${prediction.id}-${index}`}>
            <span>{index}. {option}</span>
            <span className="prediction-card__option-total">
              {prediction.isOpen
                ? 'Encrypted'
                : isDecryptingTotals
                  ? 'Decrypting...'
                  : publicTotals && publicTotals[index] !== undefined
                    ? `${publicTotals[index]} Coin`
                    : 'Unavailable'}
            </span>
          </div>
        ))}
      </div>

      {prediction.isOpen ? (
        <form className="prediction-card__bet" onSubmit={handlePlaceBet}>
          <div className="prediction-card__row">
            <label>
              Option
              <select value={selectedOption} onChange={(event) => setSelectedOption(event.target.value)}>
                {optionLabels.map((option, index) => (
                  <option key={`${prediction.id}-select-${index}`} value={index}>
                    {index}. {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bet amount (Coin)
              <input
                type="number"
                min="1"
                step="1"
                value={betAmount}
                onChange={(event) => setBetAmount(event.target.value)}
                placeholder="e.g. 250"
              />
            </label>
          </div>
          {betError && <p className="prediction-card__error">{betError}</p>}
          <div className="prediction-card__actions">
            <button type="submit" className="button button--primary" disabled={isBetting}>
              {isBetting ? 'Processing...' : 'Place encrypted bet'}
            </button>
            {isCreator ? (
              <button type="button" className="button button--ghost" onClick={endPrediction} disabled={isBetting}>
                End prediction
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="prediction-card__closed">
          <p className="prediction-card__note">Totals are publicly decryptable for closed predictions.</p>
        </div>
      )}

      <div className="prediction-card__personal">
        <div>
          <p className="prediction-card__label">Your encrypted bet</p>
          {address ? (
            myBet ? (
              <p className="prediction-card__value">
                {myBet.amount} Coin on option {myBet.choice}
              </p>
            ) : (
              <button
                type="button"
                className="button button--ghost"
                onClick={decryptMyBet}
                disabled={isDecryptingBet}
              >
                {isDecryptingBet ? 'Decrypting...' : 'Decrypt my bet'}
              </button>
            )
          ) : (
            <p className="prediction-card__value muted">Connect wallet to decrypt.</p>
          )}
        </div>
      </div>
    </article>
  );
}
