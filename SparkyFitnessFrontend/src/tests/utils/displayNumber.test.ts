import { displayQuantity, displayWholeDoses } from '@/utils/displayNumber';

describe('displayQuantity', () => {
  it('rounds a long decimal for display', () => {
    expect(displayQuantity('3.3333333333333333333', 2)).toBe('3.33');
    expect(displayQuantity('0.07500000000000000000001', 3)).toBe('0.075');
    expect(displayQuantity('266.66666666666666666', 2)).toBe('266.67');
  });
  it('drops trailing zeros and keeps whole numbers whole', () => {
    expect(displayQuantity('10.000', 3)).toBe('10');
    expect(displayQuantity(0.25, 2)).toBe('0.25');
    expect(displayQuantity('100', 2)).toBe('100');
  });
  it('does not show a small amount as zero', () => {
    expect(displayQuantity('0.0004', 2)).toBe('0.0004');
  });
  it('passes through empty and non-numeric values', () => {
    expect(displayQuantity(null)).toBe('—');
    expect(displayQuantity('')).toBe('—');
    expect(displayQuantity('abc')).toBe('abc');
  });
});

describe('displayWholeDoses', () => {
  it('rounds down to whole doses', () => {
    expect(displayWholeDoses('39.3333333')).toBe('39');
    expect(displayWholeDoses('40')).toBe('40');
    expect(displayWholeDoses('39.9999999999')).toBe('40');
    expect(displayWholeDoses(null)).toBe('—');
  });
});
