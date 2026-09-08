<script lang="ts">
  import { browser } from '#imports';
  import { onMount } from 'svelte';
  import type { DownloaderSettings, ExportFormat, TabState, TextureFormat } from '../../src/lib/types';

  let tabState: TabState | null = null;
  let settings: DownloaderSettings | null = null;
  let selectedFormat: ExportFormat = 'glb';
  let loading = true;
  let actionLoading = false;
  let showSettings = false;
  let showHistory = false;
  let userMessage = '';
  let copyFeedback = false;
  let messageTimeout: ReturnType<typeof setTimeout> | undefined;

  function setNotification(msg: string) {
    userMessage = msg;
    if (messageTimeout) clearTimeout(messageTimeout);
    messageTimeout = setTimeout(() => {
      userMessage = '';
    }, 4000);
  }

  function formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(1)} KB`;
  }

  async function loadData() {
    loading = true;
    userMessage = '';
    try {
      const [activeTabRes, settingsRes] = await Promise.all([
        browser.runtime.sendMessage({ type: 'get-active-tab-state' }),
        browser.runtime.sendMessage({ type: 'get-settings' }),
      ]);
      tabState = activeTabRes as TabState;
      settings = settingsRes as DownloaderSettings;
      if (settings?.exportFormat) {
        selectedFormat = settings.exportFormat;
      }
    } catch {
      setNotification('Failed to communicate with the background worker. Please retry.');
    } finally {
      loading = false;
    }
  }

  async function selectExportFormat(format: ExportFormat) {
    selectedFormat = format;
    try {
      settings = (await browser.runtime.sendMessage({
        type: 'update-settings',
        settings: { exportFormat: format },
      })) as DownloaderSettings;
    } catch {
      // ignore
    }
  }

  async function updateExportFormatSetting(event: Event) {
    const format = (event.currentTarget as HTMLSelectElement).value as ExportFormat;
    await selectExportFormat(format);
  }

  async function downloadModel() {
    if (actionLoading) return;
    actionLoading = true;
    userMessage = '';

    try {
      const res = (await browser.runtime.sendMessage({
        type: 'download-active-tab-mesh',
        exportFormat: selectedFormat,
      })) as { ok: boolean; error?: string; byteLength?: number };

      if (res?.ok) {
        const formatLabel = selectedFormat === 'textures' ? 'PBR Textures (.ZIP)' : selectedFormat.toUpperCase();
        setNotification(
          res.byteLength
            ? `${formatLabel} download started (${formatBytes(res.byteLength)}).`
            : `${formatLabel} download started.`,
        );
      } else {
        setNotification(res?.error ?? 'No active model found. Open or select a model first.');
      }
    } catch (err) {
      setNotification(err instanceof Error ? err.message : 'Download request failed.');
    } finally {
      actionLoading = false;
      await loadData();
    }
  }

  async function openWorkspace(targetUrl?: string) {
    if (targetUrl) {
      await browser.tabs.create({ url: targetUrl });
    } else {
      await browser.runtime.sendMessage({ type: 'open-workspace' });
    }
  }

  async function updateTextureFormat(event: Event) {
    const format = (event.currentTarget as HTMLSelectElement).value as TextureFormat;
    settings = (await browser.runtime.sendMessage({
      type: 'update-settings',
      settings: { textureFormat: format },
    })) as DownloaderSettings;
  }

  async function toggleAutoAsk(event: Event) {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    settings = (await browser.runtime.sendMessage({
      type: 'update-settings',
      settings: { autoAskToDownload: checked },
    })) as DownloaderSettings;
  }

  async function handleClearHistory() {
    await browser.runtime.sendMessage({ type: 'clear-download-history' });
    if (settings) {
      settings.downloadHistory = [];
    }
  }

  async function copyModelInfo() {
    if (!tabState?.model && !tabState?.page?.hasDecodedGlb) return;
    const model = tabState.model;
    const size = model?.size ?? tabState.page?.lastGlbSize;
    const name = model?.name ?? tabState.page?.modelName ?? 'Unknown Model';
    const provider = tabState.currentWebsiteLabel ?? 'Unknown Provider';

    const text = [
      `Model: ${name}`,
      `Provider: ${provider}`,
      `Format: ${selectedFormat.toUpperCase()}`,
      size ? `Size: ${formatBytes(size)}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      copyFeedback = true;
      setTimeout(() => {
        copyFeedback = false;
      }, 2000);
    } catch {
      // ignore
    }
  }

  let imageError = false;
  let imageLoaded = false;
  let lastPreviewUrl = '';

  $: hasModel = Boolean(tabState?.model || tabState?.page?.hasDecodedGlb || tabState?.page?.hasActiveModel);
  $: modelSize = tabState?.model?.size ?? tabState?.page?.lastGlbSize;
  $: modelName = tabState?.model?.name ?? tabState?.page?.modelName ?? 'Current 3D Model';
  $: previewUrl = tabState?.model?.previewUrl ?? tabState?.previewUrl ?? tabState?.page?.previewUrl;

  $: if (previewUrl !== lastPreviewUrl) {
    lastPreviewUrl = previewUrl || '';
    imageError = false;
    imageLoaded = false;
  }

  onMount(loadData);
</script>

<main>
  <!-- Header -->
  <header>
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <span class="title">3D Model Downloader</span>
    </div>
    <div class="header-right">
      {#if tabState?.currentWebsiteLabel}
        <span class="provider-badge">{tabState.currentWebsiteLabel}</span>
      {/if}
      <button
        class="icon-btn"
        title="Settings"
        class:active={showSettings}
        on:click={() => {
          showSettings = !showSettings;
          showHistory = false;
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    </div>
  </header>

  <!-- Content Views -->
  {#if loading}
    <div class="center-panel">
      <div class="spinner"></div>
      <p class="muted">Checking active tab...</p>
    </div>
  {:else if showSettings}
    <!-- Settings Panel -->
    <div class="panel">
      <div class="panel-header">
        <h3>Preferences</h3>
        <button class="text-btn" on:click={() => (showSettings = false)}>Done</button>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">Texture conversion</div>
          <div class="setting-desc">Re-encode embedded textures upon download</div>
        </div>
        <select
          value={settings?.textureFormat ?? 'default'}
          on:change={updateTextureFormat}
          class="select-input"
        >
          <option value="default">Original</option>
          <option value="webp">WebP</option>
          <option value="png">PNG</option>
          <option value="jpg">JPEG</option>
        </select>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">Default export format</div>
          <div class="setting-desc">Primary 3D container format to download</div>
        </div>
        <select
          value={selectedFormat}
          on:change={updateExportFormatSetting}
          class="select-input"
        >
          <option value="glb">GLB (Universal glTF 2.0)</option>
          <option value="stl">STL (3D Printing)</option>
          <option value="obj">OBJ (Wavefront 3D)</option>
          <option value="usdz">USDZ (Apple AR / iOS)</option>
          <option value="textures">ZIP (PBR Textures Only)</option>
        </select>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">Auto-ask prompt</div>
          <div class="setting-desc">Display download popup overlay on pages</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={settings?.autoAskToDownload ?? true}
            on:change={toggleAutoAsk}
          />
          <span class="slider"></span>
        </label>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">Download history</div>
          <div class="setting-desc">{settings?.downloadHistory?.length ?? 0} items stored locally</div>
        </div>
        <button
          class="secondary-sm-btn"
          on:click={() => {
            showHistory = true;
            showSettings = false;
          }}
        >
          View history
        </button>
      </div>
    </div>
  {:else if showHistory}
    <!-- History View -->
    <div class="panel">
      <div class="panel-header">
        <h3>Download History</h3>
        <div class="row-gap">
          {#if (settings?.downloadHistory?.length ?? 0) > 0}
            <button class="danger-btn" on:click={handleClearHistory}>Clear</button>
          {/if}
          <button class="text-btn" on:click={() => (showHistory = false)}>Back</button>
        </div>
      </div>

      {#if !settings?.downloadHistory?.length}
        <p class="muted center-text">No download history yet.</p>
      {:else}
        <div class="history-list">
          {#each settings.downloadHistory as item}
            <div class="history-item">
              <div class="history-title">{item.modelName || item.filename}</div>
              <div class="history-meta">
                <span class="provider-tag">{item.provider}</span>
                <span class="format-tag">{item.format ? item.format.toUpperCase() : 'GLB'}</span>
                <span>{formatBytes(item.size)}</span>
                <span>{new Date(item.timestamp).toLocaleDateString()}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if tabState?.shouldRedirect}
    <!-- Unsupported Website State -->
    <div class="center-panel">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" width="32" height="32" stroke="#6b7280" fill="none" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <p class="empty-title">Unsupported Website</p>
      <p class="muted">Open a supported 3D platform to inspect and download models:</p>
      <div class="workspace-grid">
        <button class="workspace-chip" on:click={() => openWorkspace('https://www.meshy.ai/workspace')}>
          <span class="chip-dot meshy"></span>
          Meshy
        </button>
        <button class="workspace-chip" on:click={() => openWorkspace('https://www.tripo3d.ai/app')}>
          <span class="chip-dot tripo"></span>
          Tripo3D
        </button>
        <button class="workspace-chip" on:click={() => openWorkspace('https://sketchfab.com/feed')}>
          <span class="chip-dot sketchfab"></span>
          Sketchfab
        </button>
        <button class="workspace-chip" on:click={() => openWorkspace('https://lumalabs.ai/genie')}>
          <span class="chip-dot luma"></span>
          Luma AI
        </button>
        <button class="workspace-chip" on:click={() => openWorkspace('https://poly.pizza')}>
          <span class="chip-dot polypizza"></span>
          Poly Pizza
        </button>
        <button class="workspace-chip" on:click={() => openWorkspace('https://polyhaven.com/models')}>
          <span class="chip-dot polyhaven"></span>
          Poly Haven
        </button>
        <button class="workspace-chip" on:click={() => openWorkspace('https://hyperhuman.deemos.com/rodin')}>
          <span class="chip-dot rodin"></span>
          Rodin
        </button>
      </div>
    </div>
  {:else if !hasModel}
    <!-- Supported Site but No Model Active -->
    <div class="center-panel">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" width="32" height="32" stroke="#6b7280" fill="none" stroke-width="1.5">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
      </div>
      <p class="empty-title">Select a 3D Model</p>
      <p class="muted">Click or open a model in the workspace to inspect and download it.</p>
      <button class="ghost-btn" on:click={loadData}>Refresh detection</button>
    </div>
  {:else}
    <!-- Model Ready / Detected State -->
    <div class="model-card">
      <!-- Model Thumbnail / Preview Block -->
      <div class="thumbnail-wrapper">
        {#if previewUrl && !imageError}
          {#if !imageLoaded}
            <div class="thumbnail-shimmer"></div>
          {/if}
          <img
            src={previewUrl}
            alt={modelName}
            class="thumbnail-image"
            class:loaded={imageLoaded}
            referrerpolicy="no-referrer"
            on:load={() => (imageLoaded = true)}
            on:error={() => (imageError = true)}
          />
        {:else}
          <div class="thumbnail-fallback">
            <svg class="fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
            <span class="fallback-text">3D Model</span>
          </div>
        {/if}
        <div class="thumbnail-overlay-badge">
          <span class="pill-badge format-pill">{selectedFormat.toUpperCase()}</span>
          {#if tabState?.currentWebsiteLabel}
            <span class="pill-badge provider-pill">{tabState.currentWebsiteLabel}</span>
          {/if}
        </div>
      </div>

      <div class="model-header">
        <div class="model-title-block">
          <h2 class="model-name" title={modelName}>{modelName}</h2>
          <div class="model-badge-row">
            {#if modelSize}
              <span class="badge size-badge">{formatBytes(modelSize)}</span>
            {/if}
            <span class="status-indicator">
              <span class="status-dot"></span>
              Ready to download
            </span>
          </div>
        </div>
      </div>

      <!-- Format Selector -->
      <div class="format-picker">
        <div class="format-picker-header">
          <span class="format-picker-title">Export format</span>
          <span class="format-hint">
            {#if selectedFormat === 'stl'}
              3D Print mesh (.stl)
            {:else if selectedFormat === 'obj'}
              Wavefront (.obj)
            {:else if selectedFormat === 'usdz'}
              Apple AR Quick Look (.usdz)
            {:else if selectedFormat === 'textures'}
              PBR Texture Pack (.zip)
            {:else}
              Universal binary (.glb)
            {/if}
          </span>
        </div>
        <div class="format-pills-row">
          <button
            type="button"
            class="format-pill-btn"
            class:active={selectedFormat === 'glb'}
            on:click={() => selectExportFormat('glb')}
            title="Universal glTF 2.0 binary container with full materials, textures & animations"
          >
            GLB
          </button>
          <button
            type="button"
            class="format-pill-btn"
            class:active={selectedFormat === 'stl'}
            on:click={() => selectExportFormat('stl')}
            title="Binary STL for 3D printing slicers (Cura, Prusa, Bambu Studio)"
          >
            STL
          </button>
          <button
            type="button"
            class="format-pill-btn"
            class:active={selectedFormat === 'obj'}
            on:click={() => selectExportFormat('obj')}
            title="Wavefront OBJ geometry with vertex positions, normals & UV coordinates"
          >
            OBJ
          </button>
          <button
            type="button"
            class="format-pill-btn"
            class:active={selectedFormat === 'usdz'}
            on:click={() => selectExportFormat('usdz')}
            title="Universal Scene Description package for Apple iOS AR Quick Look"
          >
            USDZ
          </button>
          <button
            type="button"
            class="format-pill-btn"
            class:active={selectedFormat === 'textures'}
            on:click={() => selectExportFormat('textures')}
            title="Extract embedded PBR textures into a ZIP archive with descriptive README"
          >
            ZIP
          </button>
        </div>
      </div>

      <!-- Primary Action -->
      <button
        class="primary-btn"
        disabled={actionLoading}
        on:click={downloadModel}
      >
        {#if actionLoading}
          <div class="btn-spinner"></div>
          <span>Preparing {selectedFormat === 'textures' ? 'PBR ZIP' : selectedFormat.toUpperCase()}...</span>
        {:else}
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download {selectedFormat === 'textures' ? 'TEXTURES (.ZIP)' : selectedFormat.toUpperCase()}</span>
        {/if}
      </button>

      <!-- Secondary Actions Row -->
      <div class="actions-row">
        <button class="action-link" on:click={copyModelInfo} title="Copy model details">
          {#if copyFeedback}
            <span class="copied-text">✓ Copied</span>
          {:else}
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy info</span>
          {/if}
        </button>
        <button class="action-link" on:click={loadData} title="Refresh model detection">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          <span>Refresh</span>
        </button>
        <button class="action-link" on:click={openWorkspace} title="Open workspace">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          <span>Workspace</span>
        </button>
      </div>
    </div>
  {/if}

  {#if userMessage}
    <div class="alert" class:error-alert={userMessage.includes('failed') || userMessage.includes('Error')}>
      {userMessage}
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background-color: #0d0f12;
    color: #e5e7eb;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }

  main {
    width: 380px;
    box-sizing: border-box;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1px solid #1f242d;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .logo {
    width: 20px;
    height: 20px;
    color: #3b82f6;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.2px;
    color: #f3f4f6;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .provider-badge {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 9999px;
    background: #1e293b;
    color: #93c5fd;
    border: 1px solid #3b82f640;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .icon-btn:hover, .icon-btn.active {
    background: #1f242d;
    color: #f3f4f6;
  }

  .center-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 16px;
    text-align: center;
    gap: 10px;
  }

  .empty-icon {
    margin-bottom: 4px;
  }

  .empty-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #e5e7eb;
  }

  .muted {
    margin: 0;
    font-size: 12px;
    color: #9ca3af;
    line-height: 1.4;
  }

  .workspace-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    width: 100%;
    margin-top: 6px;
  }

  .workspace-chip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    background: #171d26;
    border: 1px solid #263040;
    color: #e5e7eb;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .workspace-chip:hover {
    background: #202937;
    border-color: #3b82f6;
    color: #ffffff;
  }

  .chip-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .chip-dot.meshy { background: #3b82f6; }
  .chip-dot.tripo { background: #10b981; }
  .chip-dot.luma { background: #f59e0b; }
  .chip-dot.rodin { background: #ec4899; }
  .chip-dot.sketchfab { background: #0ea5e9; }
  .chip-dot.polypizza { background: #a855f7; }
  .chip-dot.polyhaven { background: #14b8a6; }

  .model-card {
    background: #13171f;
    border: 1px solid #1f2633;
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .thumbnail-wrapper {
    position: relative;
    width: 100%;
    height: 140px;
    background: #090c10;
    border-radius: 8px;
    border: 1px solid #1f2633;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .thumbnail-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transition: opacity 0.25s ease-in-out;
    background: radial-gradient(circle at center, #141a24 0%, #090c10 100%);
  }

  .thumbnail-image.loaded {
    opacity: 1;
  }

  .thumbnail-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, #13171f 25%, #1c222e 50%, #13171f 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .thumbnail-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: #4b5563;
    background: radial-gradient(circle at center, #141a24 0%, #090c10 100%);
    width: 100%;
    height: 100%;
  }

  .fallback-icon {
    width: 38px;
    height: 38px;
    color: #3b82f6;
    opacity: 0.6;
  }

  .fallback-text {
    font-size: 11px;
    font-weight: 500;
    color: #6b7280;
    letter-spacing: 0.3px;
  }

  .thumbnail-overlay-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 5px;
    pointer-events: none;
  }

  .pill-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    backdrop-filter: blur(4px);
  }

  .format-pill {
    background: rgba(37, 99, 235, 0.85);
    color: #ffffff;
    border: 1px solid rgba(59, 130, 246, 0.4);
  }

  .provider-pill {
    background: rgba(15, 23, 42, 0.85);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .model-name {
    margin: 0 0 6px 0;
    font-size: 15px;
    font-weight: 600;
    color: #f9fafb;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-badge-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .badge {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .size-badge {
    background: #1f2937;
    color: #d1d5db;
  }

  .status-indicator {
    margin-left: auto;
    font-size: 11px;
    color: #10b981;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #10b981;
    box-shadow: 0 0 6px #10b98180;
  }

  .format-picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #0e1218;
    border: 1px solid #1c222e;
    border-radius: 8px;
    padding: 8px 10px;
  }

  .format-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .format-picker-title {
    font-size: 11px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .format-hint {
    font-size: 11px;
    color: #38bdf8;
    font-weight: 500;
  }

  .format-pills-row {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }

  .format-pill-btn {
    background: #171d26;
    border: 1px solid #263040;
    color: #9ca3af;
    padding: 6px 0;
    font-size: 11px;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .format-pill-btn:hover {
    background: #202937;
    color: #f3f4f6;
    border-color: #374151;
  }

  .format-pill-btn.active {
    background: #2563eb;
    color: #ffffff;
    border-color: #3b82f6;
    box-shadow: 0 0 8px rgba(37, 99, 235, 0.4);
  }

  .format-tag {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: #1e293b;
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.3);
  }

  .primary-btn {
    width: 100%;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 11px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background 0.15s, transform 0.05s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .primary-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .primary-btn:active:not(:disabled) {
    transform: scale(0.99);
  }

  .primary-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .actions-row {
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding-top: 8px;
    border-top: 1px solid #1c222e;
  }

  .action-link {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 8px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
  }

  .action-link:hover {
    color: #f3f4f6;
    background: #1a202c;
  }

  .copied-text {
    color: #10b981;
    font-weight: 500;
  }

  .panel {
    background: #13171f;
    border: 1px solid #1f2633;
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid #1f2633;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #f3f4f6;
  }

  .setting-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .setting-label {
    font-size: 13px;
    font-weight: 500;
    color: #e5e7eb;
  }

  .setting-desc {
    font-size: 11px;
    color: #9ca3af;
    margin-top: 1px;
  }

  .select-input {
    background: #1e293b;
    border: 1px solid #334155;
    color: #f3f4f6;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 6px;
    outline: none;
  }

  .text-btn {
    background: none;
    border: none;
    color: #3b82f6;
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
  }

  .ghost-btn {
    background: #1e293b;
    color: #d1d5db;
    border: 1px solid #334155;
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .secondary-sm-btn {
    background: #1f2937;
    color: #e5e7eb;
    border: 1px solid #374151;
    font-size: 11px;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
  }

  .danger-btn {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 12px;
    cursor: pointer;
  }

  .row-gap {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .history-list {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .history-item {
    background: #0d0f12;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #1f2633;
  }

  .history-title {
    font-size: 12px;
    font-weight: 500;
    color: #f3f4f6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-meta {
    font-size: 11px;
    color: #9ca3af;
    display: flex;
    gap: 8px;
    margin-top: 3px;
  }

  .provider-tag {
    color: #60a5fa;
    text-transform: capitalize;
  }

  /* Switch styling */
  .switch {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0; left: 0; right: 0; bottom: 0;
    background-color: #374151;
    transition: 0.2s;
    border-radius: 20px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: #2563eb;
  }

  input:checked + .slider:before {
    transform: translateX(16px);
  }

  .alert {
    padding: 8px 12px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    font-size: 12px;
    color: #93c5fd;
    text-align: center;
  }

  .error-alert {
    background: #450a0a;
    border-color: #7f1d1d;
    color: #fca5a5;
  }

  .spinner {
    width: 22px;
    height: 22px;
    border: 2px solid #3b82f630;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #ffffff40;
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
