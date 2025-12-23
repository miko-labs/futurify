import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:address", "Prints the Futurify address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;

  const futurify = await deployments.get("Futurify");

  console.log("Futurify address is " + futurify.address);
});

task("task:buy-coins", "Buy encrypted coins with ETH")
  .addParam("eth", "ETH amount to spend")
  .addOptionalParam("address", "Optionally specify the Futurify contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const ethAmount = taskArguments.eth;
    const futurifyDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("Futurify");

    const [signer] = await ethers.getSigners();
    const futurify = await ethers.getContractAt("Futurify", futurifyDeployment.address);
    const tx = await futurify.connect(signer).buyCoins({ value: ethers.parseEther(ethAmount) });
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:create-prediction", "Create a prediction with comma-separated options")
  .addParam("title", "Prediction title")
  .addParam("options", "Comma-separated list of options (2-4)")
  .addOptionalParam("address", "Optionally specify the Futurify contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const options = (taskArguments.options as string)
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option.length > 0);

    if (options.length < 2 || options.length > 4) {
      throw new Error("Options must be between 2 and 4 entries");
    }

    const futurifyDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("Futurify");

    const [signer] = await ethers.getSigners();
    const futurify = await ethers.getContractAt("Futurify", futurifyDeployment.address);

    const tx = await futurify.connect(signer).createPrediction(taskArguments.title, options);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:place-bet", "Place an encrypted bet on a prediction")
  .addParam("predictionId", "Prediction id")
  .addParam("choice", "Option index starting at 0")
  .addParam("amount", "Bet amount in coin units")
  .addOptionalParam("address", "Optionally specify the Futurify contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    const predictionId = Number(taskArguments.predictionId);
    const choice = Number(taskArguments.choice);
    const amount = Number(taskArguments.amount);

    if (!Number.isInteger(predictionId) || predictionId < 0) {
      throw new Error("predictionId must be a non-negative integer");
    }
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
      throw new Error("choice must be between 0 and 3");
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("amount must be a positive integer");
    }

    await fhevm.initializeCLIApi();

    const futurifyDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("Futurify");
    const [signer] = await ethers.getSigners();

    const futurify = await ethers.getContractAt("Futurify", futurifyDeployment.address);

    const encryptedInput = await fhevm
      .createEncryptedInput(futurifyDeployment.address, signer.address)
      .add8(choice)
      .add64(amount)
      .encrypt();

    const tx = await futurify
      .connect(signer)
      .placeBet(predictionId, encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:decrypt-balance", "Decrypt the caller's encrypted balance")
  .addOptionalParam("address", "Optionally specify the Futurify contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const futurifyDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("Futurify");
    const [signer] = await ethers.getSigners();

    const futurify = await ethers.getContractAt("Futurify", futurifyDeployment.address);
    const encryptedBalance = await futurify.getBalance(signer.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      futurifyDeployment.address,
      signer,
    );

    console.log(`Encrypted balance: ${encryptedBalance}`);
    console.log(`Clear balance    : ${clearBalance}`);
  });

task("task:decrypt-totals", "Decrypt prediction totals (creator only)")
  .addParam("predictionId", "Prediction id")
  .addOptionalParam("address", "Optionally specify the Futurify contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const predictionId = Number(taskArguments.predictionId);
    if (!Number.isInteger(predictionId) || predictionId < 0) {
      throw new Error("predictionId must be a non-negative integer");
    }

    const futurifyDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("Futurify");
    const [signer] = await ethers.getSigners();

    const futurify = await ethers.getContractAt("Futurify", futurifyDeployment.address);
    const prediction = await futurify.getPrediction(predictionId);
    const totals = await futurify.getPredictionTotals(predictionId);
    const optionCount = Number(prediction[2]);

    for (let i = 0; i < optionCount; i += 1) {
      const encryptedTotal = totals[i];
      const clearTotal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedTotal,
        futurifyDeployment.address,
        signer,
      );
      console.log(`Option ${i} total: ${clearTotal}`);
    }
  });

task("task:end-prediction", "End a prediction and make totals public")
  .addParam("predictionId", "Prediction id")
  .addOptionalParam("address", "Optionally specify the Futurify contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const predictionId = Number(taskArguments.predictionId);
    if (!Number.isInteger(predictionId) || predictionId < 0) {
      throw new Error("predictionId must be a non-negative integer");
    }

    const futurifyDeployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("Futurify");
    const [signer] = await ethers.getSigners();

    const futurify = await ethers.getContractAt("Futurify", futurifyDeployment.address);
    const tx = await futurify.connect(signer).endPrediction(predictionId);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });
