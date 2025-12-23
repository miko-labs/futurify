import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { Futurify, Futurify__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("Futurify")) as Futurify__factory;
  const futurifyContract = (await factory.deploy()) as Futurify;
  const futurifyContractAddress = await futurifyContract.getAddress();

  return { futurifyContract, futurifyContractAddress };
}

describe("Futurify", function () {
  let signers: Signers;
  let futurifyContract: Futurify;
  let futurifyContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ futurifyContract, futurifyContractAddress } = await deployFixture());
  });

  it("mints encrypted coins when buying with ETH", async function () {
    const tx = await futurifyContract.connect(signers.alice).buyCoins({ value: ethers.parseEther("1") });
    await tx.wait();

    const encryptedBalance = await futurifyContract.getBalance(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      futurifyContractAddress,
      signers.alice,
    );

    expect(clearBalance).to.eq(1_000_000);
  });

  it("rejects predictions with invalid option counts", async function () {
    await expect(
      futurifyContract.connect(signers.alice).createPrediction("Invalid", ["OnlyOne"]),
    ).to.be.revertedWithCustomError(futurifyContract, "InvalidOptions");
  });

  it("places encrypted bets and updates totals", async function () {
    await futurifyContract.connect(signers.alice).buyCoins({ value: ethers.parseEther("1") });
    await futurifyContract
      .connect(signers.alice)
      .createPrediction("Rain tomorrow?", ["Yes", "No", "Maybe"]);

    const encryptedInput = await fhevm
      .createEncryptedInput(futurifyContractAddress, signers.alice.address)
      .add8(1)
      .add64(500)
      .encrypt();

    const tx = await futurifyContract
      .connect(signers.alice)
      .placeBet(0, encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof);
    await tx.wait();

    const encryptedBalance = await futurifyContract.getBalance(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      futurifyContractAddress,
      signers.alice,
    );
    expect(clearBalance).to.eq(1_000_000 - 500);

    const encryptedChoice = await futurifyContract.getUserChoice(0, signers.alice.address);
    const clearChoice = await fhevm.userDecryptEuint(
      FhevmType.euint8,
      encryptedChoice,
      futurifyContractAddress,
      signers.alice,
    );
    expect(clearChoice).to.eq(1);

    const encryptedBet = await futurifyContract.getUserBet(0, signers.alice.address);
    const clearBet = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBet,
      futurifyContractAddress,
      signers.alice,
    );
    expect(clearBet).to.eq(500);

    const totals = await futurifyContract.getPredictionTotals(0);
    const totalYes = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      totals[0],
      futurifyContractAddress,
      signers.alice,
    );
    const totalNo = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      totals[1],
      futurifyContractAddress,
      signers.alice,
    );

    expect(totalYes).to.eq(0);
    expect(totalNo).to.eq(500);
  });

  it("allows the creator to end a prediction", async function () {
    await futurifyContract
      .connect(signers.alice)
      .createPrediction("Close market?", ["Yes", "No"]);

    const tx = await futurifyContract.connect(signers.alice).endPrediction(0);
    await tx.wait();

    const prediction = await futurifyContract.getPrediction(0);
    expect(prediction[3]).to.eq(false);
  });
});
