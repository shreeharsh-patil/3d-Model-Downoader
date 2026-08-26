import type { WebsiteId } from '../types';
import { lumaProvider } from './luma/luma-provider';
import { meshyProvider } from './meshy/meshy-provider';
import type { ModelProvider } from './provider.interface';
import { rodinProvider } from './rodin/rodin-provider';
import { tripoProvider } from './tripo/tripo-provider';

const providers: ModelProvider[] = [meshyProvider, tripoProvider, lumaProvider, rodinProvider];

export function getProviders(): readonly ModelProvider[] {
  return providers;
}

export function findProvider(url?: string): ModelProvider | undefined {
  if (!url) return undefined;
  return providers.find((provider) => provider.matchesUrl(url));
}

export function getProviderById(id?: string): ModelProvider | undefined {
  if (!id) return undefined;
  return providers.find((provider) => provider.id === id);
}

export function isSupportedUrl(url?: string): boolean {
  return findProvider(url) !== undefined;
}
