import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedFuturify = await deploy("Futurify", {
    from: deployer,
    log: true,
  });

  console.log(`Futurify contract: `, deployedFuturify.address);
};
export default func;
func.id = "deploy_futurify"; // id required to prevent reexecution
func.tags = ["Futurify"];
