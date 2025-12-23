# Futurify

Futurify is an encrypted prediction market built on Zama FHEVM. Users buy an
encrypted Coin balance, create predictions with 2-4 options, and place private
stakes and choices. All critical values stay encrypted on-chain until the
prediction is closed and the totals are made public.

## Why This Exists

Traditional prediction markets expose who bet, how much, and early odds. That
creates information leakage, front-running, coordination pressure, and biased
signals. Futurify uses fully homomorphic encryption (FHE) so the market can
operate with privacy by default, while still settling on-chain.

## Core Features

- Buy Coin with ETH at a fixed rate: 1 ETH = 1,000,000 Coin (encrypted balance)
- Create a prediction with a name and 2-4 options
- Choose any prediction and place an encrypted stake and encrypted choice
- Maintain encrypted per-option totals on-chain
- Close a prediction to reveal totals publicly and make results decryptable

## Advantages

- Privacy-preserving participation: choices and stakes stay hidden until close
- Reduced market manipulation: no early leakage of odds or whale signals
- Verifiable settlement: totals can be revealed and audited on-chain
- Simple UX: a single Coin balance supports all predictions
- Non-custodial flow: assets and results are enforced by the contract

## Problems Solved

- Public betting histories that reveal strategies and identities
- Early odds manipulation and front-running
- Unfair coordination pressure from visible vote totals
- Lack of credible privacy in on-chain prediction markets

## Technology Stack

- Smart contracts: Solidity, Hardhat
- Privacy layer: Zama FHEVM
- Frontend: React + Vite
- Wallet and chain access: RainbowKit, viem (read), ethers (write)
- Package manager: npm

## How It Works

1. A user buys Coin with ETH. Their Coin balance is stored encrypted.
2. A creator defines a prediction with 2-4 options.
3. Participants choose an option and stake encrypted Coin.
4. The contract tracks encrypted totals for each option.
5. The creator or anyone ends the prediction, revealing totals publicly.

## Repository Layout

```
contracts/   Smart contracts
deploy/      Deployment scripts
tasks/       Hardhat tasks
test/        Contract tests
home/        Frontend (React + Vite)
docs/        Zama references and guides
```

## Prerequisites

- Node.js 20+
- npm

## Installation

```bash
npm install
cd home
npm install
```

## Configuration

Deployment uses a local `.env` file in the repo root. Frontend builds do not
use environment variables.

```
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=your_private_key
ETHERSCAN_API_KEY=optional_key
```

Notes:
- Deployment uses a private key, not a mnemonic.
- Keep keys private and never commit `.env`.

## Compile and Test

```bash
npm run compile
npm run test
```

## Local Development

```bash
npx hardhat node
npx hardhat deploy --network localhost
```

```bash
cd home
npm run dev
```

## Deploy to Sepolia

```bash
npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## Frontend Notes

- Reads use viem, writes use ethers.
- No mock data: all data comes from the deployed contracts.
- Frontend avoids localhost chains and local storage by design.

## Usage Flow

1. Connect a wallet.
2. Buy Coin with ETH.
3. Create a prediction with 2-4 options.
4. Pick an option and stake Coin.
5. Close the prediction to publish totals.

## Limitations and Risks

- FHE is compute-heavy; gas costs are higher than non-private flows.
- This project is a prototype and has not been audited.
- Results are only as fair as the prediction creator and any off-chain oracle.

## Future Roadmap

- Multiple resolution paths (creator, oracle, consensus)
- Dispute windows and challenge flows
- Better price discovery and dynamic staking models
- Multi-market dashboards and analytics
- Gas and latency optimizations for FHE operations
- Expanded UI onboarding and education for privacy guarantees

## License

BSD-3-Clause-Clear. See `LICENSE`.
