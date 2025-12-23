import { type FormEvent, useMemo, useState } from 'react';
import type { JsonRpcSigner } from 'ethers';
import { Contract, ZeroHash, parseEther } from 'ethers';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { Header } from './Header';
import { PredictionCard, type PredictionMeta } from './PredictionCard';
import '../styles/PredictionApp.css';

const COIN_RATE = 1_000_000;
const DEFAULT_DURATION_DAYS = '10';

function shortHandle(value?: string) {
  if (!value) {
    return '--';
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function PredictionApp() {
  const { address } = useAccount();
  const signerPromise = useEthersSigner() as Promise<JsonRpcSigner> | undefined;
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [ethAmount, setEthAmount] = useState('0.01');
  const [isBuying, setIsBuying] = useState(false);
  const [buyNotice, setBuyNotice] = useState<string | null>(null);
  const [clearBalance, setClearBalance] = useState<string | null>(null);
  const [isDecryptingBalance, setIsDecryptingBalance] = useState(false);

  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [isCreating, setIsCreating] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  const { data: encryptedBalance, refetch: refetchBalance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getBalance',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const { data: predictionCountData, refetch: refetchCount } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'predictionCount',
  });

  const predictionCount = Number(predictionCountData ?? 0);

  const predictionCalls = useMemo(() => {
    if (!predictionCount) {
      return [];
    }

    return Array.from({ length: predictionCount }, (_, index) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getPrediction' as const,
      args: [BigInt(index)] as const,
    }));
  }, [predictionCount]);

  const { data: predictionsData, isLoading: predictionsLoading, refetch: refetchPredictions } = useReadContracts({
    contracts: predictionCalls,
    query: {
      enabled: predictionCount > 0,
    },
  });

  const predictions = useMemo(() => {
    if (!predictionsData) {
      return [];
    }

    return predictionsData
      .map((entry, index) => {
        if (!entry?.result) {
          return null;
        }
        const [predictionTitle, predictionOptions, optionCount, isOpen, createdAt, creator] = entry.result;
        return {
          id: index,
          title: predictionTitle,
          options: predictionOptions,
          optionCount: Number(optionCount),
          isOpen,
          createdAt: Number(createdAt),
          creator,
        } as PredictionMeta;
      })
      .filter((entry): entry is PredictionMeta => Boolean(entry));
  }, [predictionsData]);

  const openCount = predictions.filter((prediction) => prediction.isOpen).length;
  const relayerStatus = zamaError
    ? 'Relayer offline. Refresh to retry.'
    : zamaLoading
      ? 'Initializing relayer for encrypted inputs...'
      : 'Relayer ready for encrypted inputs.';

  const refreshAll = async () => {
    if (address) {
      await refetchBalance();
    }
    const countResult = await refetchCount();
    const countValue = Number(countResult.data ?? predictionCount);
    if (countValue > 0) {
      await refetchPredictions();
    }
  };

  const handleBuyCoins = async () => {
    setBuyNotice(null);
    if (!signerPromise) {
      setBuyNotice('Connect your wallet to buy coins.');
      return;
    }

    const amountNumber = Number(ethAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setBuyNotice('Enter a valid ETH amount.');
      return;
    }

    setIsBuying(true);
    try {
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.buyCoins({ value: parseEther(ethAmount) });
      await tx.wait();
      setBuyNotice('Coins minted. Decrypt your balance to view it.');
      setClearBalance(null);
      await refetchBalance();
    } catch (error) {
      console.error('Failed to buy coins:', error);
      setBuyNotice('Purchase failed. Please try again.');
    } finally {
      setIsBuying(false);
    }
  };

  const decryptBalance = async () => {
    if (!instance || !address || !signerPromise || !encryptedBalance) {
      return;
    }
    const balanceHandle = encryptedBalance as string;

    if (balanceHandle === ZeroHash) {
      setClearBalance('0');
      return;
    }

    setIsDecryptingBalance(true);
    try {
      const keypair = instance.generateKeypair();
      const handleContractPairs = [
        {
          handle: balanceHandle,
          contractAddress: CONTRACT_ADDRESS,
        },
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

      const decrypted = result[balanceHandle] ?? '0';
      setClearBalance(decrypted.toString());
    } catch (error) {
      console.error('Failed to decrypt balance:', error);
      setBuyNotice('Balance decryption failed.');
    } finally {
      setIsDecryptingBalance(false);
    }
  };

  const updateOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((option, optionIndex) => (optionIndex === index ? value : option)));
  };

  const addOption = () => {
    if (options.length >= 4) {
      return;
    }
    setOptions((prev) => [...prev, '']);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) {
      return;
    }
    setOptions((prev) => prev.filter((_, optionIndex) => optionIndex !== index));
  };

  const handleCreatePrediction = async (event: FormEvent) => {
    event.preventDefault();
    setCreateNotice(null);

    const trimmedTitle = title.trim();
    const cleanedOptions = options.map((option) => option.trim()).filter((option) => option.length > 0);
    if (!trimmedTitle) {
      setCreateNotice('Add a prediction title.');
      return;
    }
    if (cleanedOptions.length < 2 || cleanedOptions.length > 4) {
      setCreateNotice('Provide between 2 and 4 options.');
      return;
    }
    if (!signerPromise) {
      setCreateNotice('Connect your wallet to create predictions.');
      return;
    }

    setIsCreating(true);
    try {
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.createPrediction(trimmedTitle, cleanedOptions);
      await tx.wait();
      setTitle('');
      setOptions(['', '']);
      setCreateNotice('Prediction created. Share it with your community.');
      await refreshAll();
    } catch (error) {
      console.error('Failed to create prediction:', error);
      setCreateNotice('Creation failed. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <section className="hero">
          <div className="hero-content">
            <p className="hero-kicker">FHE powered prediction studio</p>
            <h1 className="hero-title">Make bold calls. Keep every bet private.</h1>
            <p className="hero-subtitle">
              Futurify lets communities stake encrypted Coin on outcomes. Totals stay hidden until you close the
              prediction, then the world can decrypt the final numbers.
            </p>
            <div className="hero-badges">
              <span>1 ETH = {COIN_RATE.toLocaleString()} Coin</span>
              <span>Sepolia + Zama Relayer</span>
            </div>
          </div>
          <div className="hero-card">
            <div className="stat-grid">
              <div className="stat-card">
                <p className="stat-value">{predictionCount}</p>
                <p className="stat-label">Predictions</p>
              </div>
              <div className="stat-card">
                <p className="stat-value">{openCount}</p>
                <p className="stat-label">Open markets</p>
              </div>
              <div className="stat-card">
                <p className="stat-value">{address ? 'Connected' : 'Disconnected'}</p>
                <p className="stat-label">Wallet status</p>
              </div>
            </div>
            <div className="hero-card__note">{relayerStatus}</div>
          </div>
        </section>

        <section className="panel-grid">
          <div className="panel">
            <h2 className="panel-title">Encrypted balance</h2>
            <p className="panel-subtitle">Decrypt your Coin balance with Zama user decryption.</p>
            <div className="balance-card">
              <div>
                <p className="balance-label">Current Coin balance</p>
                <p className="balance-value">{address ? (clearBalance ?? 'Encrypted') : 'Connect wallet'}</p>
              </div>
              <button
                type="button"
                className="button button--primary"
                onClick={decryptBalance}
                disabled={!address || zamaLoading || isDecryptingBalance}
              >
                {isDecryptingBalance ? 'Decrypting...' : 'Decrypt balance'}
              </button>
            </div>
            <p className="panel-footnote">
              Encrypted handle: <span className="mono">{shortHandle(encryptedBalance as string)}</span>
            </p>
          </div>

          <div className="panel">
            <h2 className="panel-title">Buy Coin with ETH</h2>
            <p className="panel-subtitle">Funds stay on-chain while your balance remains encrypted.</p>
            <label className="field">
              ETH amount
              <input
                type="number"
                min="0.0001"
                step="0.0001"
                value={ethAmount}
                onChange={(event) => setEthAmount(event.target.value)}
              />
            </label>
            <p className="panel-footnote">
              Estimated Coin: {Number.isFinite(Number(ethAmount)) ? Math.floor(Number(ethAmount) * COIN_RATE) : 0}
            </p>
            {buyNotice && <p className="notice">{buyNotice}</p>}
            <button
              type="button"
              className="button button--primary"
              onClick={handleBuyCoins}
              disabled={isBuying}
            >
              {isBuying ? 'Confirming...' : 'Buy encrypted Coin'}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Create a prediction</h2>
              <p className="panel-subtitle">Choose 2-4 options. The title and options are public.</p>
            </div>
            <span className="panel-chip">Creator tools</span>
          </div>
          <form className="prediction-form" onSubmit={handleCreatePrediction}>
            <label className="field">
              Prediction title
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Will Bitcoin close above $80k this week?"
              />
            </label>
            <div className="options-grid">
              {options.map((option, index) => (
                <div className="option-field" key={`option-${index}`}>
                  <label className="field">
                    Option {index + 1}
                    <input
                      type="text"
                      value={option}
                      onChange={(event) => updateOption(index, event.target.value)}
                      placeholder={`Option ${index + 1}`}
                    />
                  </label>
                  {options.length > 2 ? (
                    <button type="button" className="button button--ghost" onClick={() => removeOption(index)}>
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="prediction-actions">
              <button type="button" className="button button--ghost" onClick={addOption} disabled={options.length >= 4}>
                Add option
              </button>
              <button type="submit" className="button button--primary" disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Publish prediction'}
              </button>
            </div>
            {createNotice && <p className="notice">{createNotice}</p>}
          </form>
        </section>

        <section className="prediction-list">
          <div className="section-header">
            <h2 className="section-title">Active predictions</h2>
            <button type="button" className="button button--ghost" onClick={refreshAll}>
              Refresh
            </button>
          </div>
          {predictionsLoading && <p className="muted">Loading predictions...</p>}
          {!predictionsLoading && predictions.length === 0 ? (
            <div className="empty-state">
              <p>No predictions yet. Create one to get started.</p>
            </div>
          ) : null}
          <div className="prediction-grid">
            {predictions.map((prediction) => (
              <PredictionCard
                key={`prediction-${prediction.id}`}
                prediction={prediction}
                address={address}
                instance={instance}
                signerPromise={signerPromise}
                onRefresh={refreshAll}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
