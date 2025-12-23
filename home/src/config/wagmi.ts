import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Futurify',
  projectId: 'futurify-demo',
  chains: [sepolia],
  ssr: false,
});
