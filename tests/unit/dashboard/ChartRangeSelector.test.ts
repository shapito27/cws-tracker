// @vitest-environment jsdom

/**
 * ChartRangeSelector — the shared 7/30/90/365/All toggle above history charts.
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ChartRangeSelector from '@/dashboard/components/charts/ChartRangeSelector.vue';

describe('ChartRangeSelector', () => {
  it('renders one button per range and marks the active one', () => {
    const wrapper = mount(ChartRangeSelector, { props: { modelValue: '30' } });
    const buttons = wrapper.findAll('button');
    expect(buttons.map((b) => b.text())).toEqual(['7d', '30d', '90d', '365d', 'All']);
    expect(buttons[1].attributes('aria-pressed')).toBe('true');
    expect(buttons[0].attributes('aria-pressed')).toBe('false');
  });

  it('emits the clicked range', async () => {
    const wrapper = mount(ChartRangeSelector, { props: { modelValue: '30' } });
    await wrapper.findAll('button')[4].trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['all']);
  });

  it('disables every button while charts reload', () => {
    const wrapper = mount(ChartRangeSelector, { props: { modelValue: '7', disabled: true } });
    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });
});
