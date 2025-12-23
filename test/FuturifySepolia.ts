import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { Futurify } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  alice: HardhatEthersSigner;
};

describe("FuturifySepolia", function () {
  let signers: Signers;
  let futurifyContract: Futurify;
  let futurifyContractAddress: string;
  let step: number;
  let steps: number;

  function progress(message: string) {
    console.log(`${++step}/${steps} ${message}`);
  }

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const futurifyDeployment = await deployments.get("Futurify");
      futurifyContractAddress = futurifyDeployment.address;
      futurifyContract = await ethers.getContractAt("Futurify", futurifyDeployment.address);
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw e;
    }

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  beforeEach(async () => {
    step = 0;
    steps = 0;
  });

  it("creates a prediction and places a bet", async function () {
    steps = 7;
    this.timeout(4 * 40000);

    progress("Buying coins...");
    let tx = await futurifyContract.connect(signers.alice).buyCoins({ value: ethers.parseEther("0.001") });
    await tx.wait();

    progress("Creating prediction...");
    tx = await futurifyContract
      .connect(signers.alice)
      .createPrediction("Will ETH gas drop?", ["Yes", "No"]);
    await tx.wait();

    progress("Encrypting bet inputs...");
    const encryptedInput = await fhevm
      .createEncryptedInput(futurifyContractAddress, signers.alice.address)
      .add8(0)
      .add64(25)
      .encrypt();

    progress("Placing bet...");
    tx = await futurifyContract
      .connect(signers.alice)
      .placeBet(0, encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof);
    await tx.wait();

    progress("Decrypting user bet...");
    const encryptedBet = await futurifyContract.getUserBet(0, signers.alice.address);
    const clearBet = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBet,
      futurifyContractAddress,
      signers.alice,
    );

    expect(clearBet).to.eq(25);
  });
});
