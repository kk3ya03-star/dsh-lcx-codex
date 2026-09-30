// QA-only overlay. Load after dsh-lcx-codex in an isolated DSH profile.
// Restore official measurement on both the root and live agent scopes.
import { symbols } from '@deepseek-ai/cordis';
const meterIdentity = meter => meter?.[symbols.original] ?? meter;
const disabled = new WeakMap();
export function disableSearchMeasurement(meter) {
  meter = meterIdentity(meter);
  let record = disabled.get(meter);
  if (!record) {
    const own = Object.getOwnPropertyDescriptor(meter, 'measure');
    const official = Object.getPrototypeOf(meter)?.measure;
    if (!own?.configurable || typeof own.value !== 'function' || typeof official !== 'function' || own.value === official)
      throw new Error('Issue 62 QA overlay requires the installed LCX measurement adapter');
    delete meter.measure;
    record = { own, refs: 0 };
    disabled.set(meter, record);
  }
  record.refs++;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (--record.refs) return;
    if (Object.hasOwn(meter, 'measure')) throw new Error('Issue 62 QA overlay: measurement changed during comparison');
    Object.defineProperty(meter, 'measure', record.own);
    disabled.delete(meter);
  };
}

export function apply(ctx) {
  const restores = new Map();
  const disable = (meter, required = false) => {
    meter = meterIdentity(meter);
    if (!meter || restores.has(meter)) return;
    // A scope can inherit the already-disabled root's prototype method.
    if (!required && !Object.hasOwn(meter, 'measure') && !disabled.has(meter)) return;
    restores.set(meter, disableSearchMeasurement(meter));
  };
  const scoped = agent => disable(agent?.ctx?.get?.('tokenMeter'));
  ctx.inject(['tokenMeter'], c => {
    c.effect(() => {
      disable(c.tokenMeter, true);
      return () => {
        for (const restore of restores.values()) restore();
        restores.clear();
      };
    }, 'issue 62 QA adapter-off comparison');
  });
  ctx.on('agent/created', ({ agent }) => scoped(agent), { global: true });
  ctx.on('agent/pre-step', ({ agent }, next) => { scoped(agent); return next(); }, { global: true });
  ctx.on('agent/disposed', ({ agent }) => {
    const meter = meterIdentity(agent?.ctx?.get?.('tokenMeter'));
    // Never restore the shared root while the overlay is still loaded.
    if (!meter || meter === meterIdentity(ctx.tokenMeter)) return;
    restores.get(meter)?.();
    restores.delete(meter);
  }, { global: true });
}

export default apply;
