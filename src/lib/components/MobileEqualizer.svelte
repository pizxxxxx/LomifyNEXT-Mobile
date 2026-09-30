<script lang="ts">
  import { RotateCcw } from 'lucide-svelte';
  import { equalizerBands, activeEqualizerPreset, settings } from '$lib/stores';
  const frequencies = ['32 Гц', '64 Гц', '125 Гц', '250 Гц', '500 Гц', '1 кГц', '2 кГц', '4 кГц', '8 кГц', '16 кГц'];
  const presets = [
    { id: 'flat', label: 'Ровно', gains: [0,0,0,0,0,0,0,0,0,0] },
    { id: 'bass', label: 'Бас', gains: [4,3,2,1,0,0,-1,-1,0,0] },
    { id: 'vocal', label: 'Вокал', gains: [-2,-1,0,1,2,3,2,1,0,-1] },
    { id: 'rock', label: 'Рок', gains: [3,2,1,0,-1,-1,1,2,3,2] },
    { id: 'electronic', label: 'Электроника', gains: [3,3,1,0,-1,0,1,2,3,3] }
  ];
  function save() {
    settings.update(s => ({ ...s, mobileEqGains: [...$equalizerBands], mobileEqPreset: $activeEqualizerPreset }));
  }
  function preset(value: typeof presets[number]) {
    equalizerBands.set([...value.gains]);
    activeEqualizerPreset.set(value.id);
    settings.update(s => ({ ...s, mobileEqEnabled: value.id !== 'flat', mobileEqGains: [...value.gains], mobileEqPreset: value.id }));
  }
</script>

<section class="mobile-equalizer">
  <h1>Эквалайзер</h1>
  <p class="mobile-hint">Настрой звук под свои наушники. Изменения слышны во время воспроизведения.</p>
  <div class="mobile-preference-card">
    <label class="mobile-preference-row"><span><strong>Эквалайзер</strong><small>{$settings.mobileEqEnabled ? 'Обработка звука включена' : 'Обработка звука выключена'}</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileEqEnabled} /></label>
  </div>
  <div class="mobile-eq-presets" role="group" aria-label="Настройки звука">
    {#each presets as value}<button class="mobile-secondary" aria-pressed={$activeEqualizerPreset === value.id} onclick={() => preset(value)}>{value.label}</button>{/each}
  </div>
  <div class="mobile-preference-card mobile-eq-bands">
    {#each frequencies as frequency, index}
      <label class="mobile-eq-band"><span>{frequency}</span><input type="range" min="-12" max="12" step="0.5" bind:value={$equalizerBands[index]} disabled={!$settings.mobileEqEnabled} oninput={() => activeEqualizerPreset.set('custom')} onchange={save} aria-label={frequency} /><output>{Number($equalizerBands[index]) > 0 ? '+' : ''}{Number($equalizerBands[index]).toFixed(1)}</output></label>
    {/each}
  </div>
  <button class="mobile-secondary" onclick={() => preset(presets[0])}><RotateCcw size={18} aria-hidden="true" /> Сбросить полосы</button>
  <p class="mobile-hint">Если звук искажается, уменьши усиление полос. При ровной настройке обработка звука отключается автоматически.</p>
</section>
