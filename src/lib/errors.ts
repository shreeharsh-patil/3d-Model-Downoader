export class DownloaderError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(message: string, code = 'DOWNLOADER_ERROR', userMessage?: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.userMessage = userMessage ?? message;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsupportedProviderError extends DownloaderError {
  constructor(url?: string) {
    super(
      `Unsupported provider or URL: ${url ?? 'unknown'}`,
      'UNSUPPORTED_PROVIDER',
      'Open a supported 3D model website (Meshy or Tripo3D).',
    );
  }
}

export class NoModelSelectedError extends DownloaderError {
  constructor() {
    super(
      'No 3D model is currently selected on the active page.',
      'NO_MODEL_SELECTED',
      'Select or open a model in the workspace to continue.',
    );
  }
}

export class ModelGeneratingError extends DownloaderError {
  constructor() {
    super(
      'Model is still generating on the server.',
      'MODEL_GENERATING',
      'Your model is still generating. Please wait until generation completes.',
    );
  }
}

export class ModelNotAvailableError extends DownloaderError {
  constructor(reason?: string) {
    super(
      reason ?? 'Model asset is not yet available in memory or network.',
      'MODEL_NOT_AVAILABLE',
      'Model is not ready yet. Click or view the model in the workspace to load it.',
    );
  }
}

export class InvalidGlbError extends DownloaderError {
  constructor(reason: string) {
    super(
      `Invalid GLB asset: ${reason}`,
      'INVALID_GLB',
      `Invalid 3D model data: ${reason}`,
    );
  }
}

export class AssetExpiredError extends DownloaderError {
  constructor() {
    super(
      'The model signed asset URL has expired.',
      'ASSET_EXPIRED',
      'The model link expired. Please refresh the page or re-select the model.',
    );
  }
}

export class NetworkError extends DownloaderError {
  constructor(details: string) {
    super(
      `Network request failed: ${details}`,
      'NETWORK_ERROR',
      `Network request failed: ${details}`,
    );
  }
}

export class ProcessingError extends DownloaderError {
  constructor(details: string) {
    super(
      `Failed to process 3D model: ${details}`,
      'PROCESSING_ERROR',
      `Failed to prepare GLB: ${details}`,
    );
  }
}

export class DownloadError extends DownloaderError {
  constructor(details: string) {
    super(
      `Download error: ${details}`,
      'DOWNLOAD_ERROR',
      `Download failed: ${details}`,
    );
  }
}

export class AbortedDownloadError extends DownloaderError {
  constructor() {
    super(
      'Download or processing was cancelled because the model changed.',
      'ABORTED_DOWNLOAD',
      'Operation cancelled.',
    );
  }
}

export function getUserErrorMessage(error: unknown): string {
  if (error instanceof DownloaderError) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred.';
}
