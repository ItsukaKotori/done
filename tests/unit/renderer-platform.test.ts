import { describe, it, expect } from 'vitest';
import { isMacUserAgent, displayAcceleratorFor } from '@/lib/platform';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Electron/45.0.0';
const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Electron/45.0.0';

describe('isMacUserAgent', () => {
  it('Mac UA 命中', () => {
    expect(isMacUserAgent(MAC_UA)).toBe(true);
  });

  it('Windows UA 不命中', () => {
    expect(isMacUserAgent(WIN_UA)).toBe(false);
  });

  it('iOS「like Mac OS X」措辞不误判', () => {
    expect(isMacUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe(false);
  });
});

describe('displayAcceleratorFor', () => {
  it('mac 上 Super 显示为 Cmd', () => {
    expect(displayAcceleratorFor('Super+Alt+A', true)).toBe('Cmd+Alt+A');
  });

  it('win 原样显示', () => {
    expect(displayAcceleratorFor('Ctrl+Alt+A', false)).toBe('Ctrl+Alt+A');
  });
});
