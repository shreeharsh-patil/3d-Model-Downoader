type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private enabled = true;

  setDebugEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  private sanitize(arg: unknown): unknown {
    if (arg === null || arg === undefined) return arg;
    if (typeof arg === 'string') {
      return arg
        .replace(/([?&](?:Signature|token|auth|key|sig)=)[^&]+/gi, '$1[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]');
    }
    if (typeof arg === 'object') {
      if (arg instanceof Error) return arg;
      if (ArrayBuffer.isView(arg) || arg instanceof ArrayBuffer) {
        return `[Binary ${(arg as ArrayBuffer).byteLength ?? (arg as Uint8Array).byteLength} bytes]`;
      }
      try {
        const sanitized: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(arg as Record<string, unknown>)) {
          if (/signature|token|auth|cookie|password|secret/i.test(key)) {
            sanitized[key] = '[REDACTED]';
          } else {
            sanitized[key] = this.sanitize(val);
          }
        }
        return sanitized;
      } catch {
        return '[Object]';
      }
    }
    return arg;
  }

  private log(level: LogLevel, scope: string, ...args: unknown[]) {
    if (level === 'debug' && !this.enabled) return;

    const prefix = `[PolyFetch 3D][${scope}]`;
    const sanitizedArgs = args.map((a) => this.sanitize(a));

    switch (level) {
      case 'debug':
        console.debug(prefix, ...sanitizedArgs);
        break;
      case 'info':
        console.info(prefix, ...sanitizedArgs);
        break;
      case 'warn':
        console.warn(prefix, ...sanitizedArgs);
        break;
      case 'error':
        console.error(prefix, ...sanitizedArgs);
        break;
    }
  }

  debug(scope: string, ...args: unknown[]) {
    this.log('debug', scope, ...args);
  }

  info(scope: string, ...args: unknown[]) {
    this.log('info', scope, ...args);
  }

  warn(scope: string, ...args: unknown[]) {
    this.log('warn', scope, ...args);
  }

  error(scope: string, ...args: unknown[]) {
    this.log('error', scope, ...args);
  }
}

export const logger = new Logger();
