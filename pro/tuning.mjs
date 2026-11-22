export const DISTANCE_MODES = ['0.01 mm', '0.005 mm', 'Percentage'];

export function displayDistance(value, travel, precision, scale = 1000) {
  return value * (precision === 2 ? 100 : travel / 1000) / scale;
}

export function storedDistance(value, travel, precision, min, max, scale = 1000) {
  const fullTravel = precision === 2 ? 100 : travel / 1000;
  return Math.min(max, Math.max(min, Math.round(value * scale / fullTravel)));
}

export function distanceField(value, travel, precision, min, max, scale = 1000) {
  const step = [0.01, 0.005, 0.1][precision];
  const distance = n => displayDistance(n, travel, precision, scale);
  const bound = n => Number(n.toFixed(6));
  return {
    value: bound(distance(value)),
    min: bound(Math.floor(distance(min) / step + 1e-8) * step),
    max: bound(Math.ceil(distance(max) / step - 1e-8) * step),
    step,
    unit: precision === 2 ? '%' : 'mm',
  };
}

export function distanceLabel(value, travel, precision) {
  const display = displayDistance(value, travel, precision);
  return precision === 2 ? display.toFixed(1) + '%' : display.toFixed(precision === 1 ? 3 : 2) + ' mm';
}
