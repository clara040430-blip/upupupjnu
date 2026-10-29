/**
 * PV-CLLC (F28388D) ADC engineering-unit conversion, revision 1.
 *
 * Source: confirmed control-board schematic + sensing calculation screenshots.
 * Values below are NOMINAL design assumptions, NOT measured calibrations.
 * The current channel's positive direction is deliberately NOT guessed.
 * This is monitoring math; it MUST NOT be used as the sole protection path.
 */

export const ADC_SPEC = Object.freeze({
  resolutionBits: 12,
  maxCount: 4095,
  codeLevels: 4096,
  referenceVoltageV: 3.3,
});

// Physical ADC input names, NOT ADC SOC indices or MCU package pin numbers.
export const SENSOR_SPEC = Object.freeze({
  vpv: Object.freeze({ adcInput: 'ADCA3', kind: 'voltage', voltsPerUnit: 0.078 }),
  ipv: Object.freeze({ adcInput: 'ADCA2', kind: 'current', voltsPerUnit: 0.026 }),
  vdc: Object.freeze({ adcInput: 'ADCD1', kind: 'voltage', voltsPerUnit: 0.057 }),
  idc: Object.freeze({ adcInput: 'ADCD0', kind: 'current', voltsPerUnit: 0.036 }),
  tr1: Object.freeze({ adcInput: 'ADCD2', kind: 'ntc', betaK: 3988 }),
  tr2: Object.freeze({ adcInput: 'ADCD3', kind: 'ntc', betaK: 3988 }),
  tr3: Object.freeze({ adcInput: 'ADCD4', kind: 'ntc', betaK: 3988 }),
  m1: Object.freeze({ adcInput: 'ADCA4', kind: 'ntc', betaK: 3984 }),
  m2: Object.freeze({ adcInput: 'ADCA5', kind: 'ntc', betaK: 3984 }),
});

export const NOMINAL_SENSING = Object.freeze({
  // The current-sensing circuit has approximately 1.65 V at 0 A.
  currentZeroVoltageV: 1.65,
  // Fixed bottom resistor of the NTC divider (nominal, schematic-based).
  ntcBottomResistorOhm: 1500,
  ntcNominalResistanceOhm: 10000,
  ntcReferenceTemperatureK: 298.15, // 25 degrees Celsius
  ntcSupplyVoltageV: 3.3,
});

/** Convert integer ADC count into voltage at the ADC input pin. */
export function adcCountToVolts(rawCount) {
  if (!Number.isInteger(rawCount) || rawCount < 0 || rawCount > ADC_SPEC.maxCount) {
    return null;
  }
  return rawCount * ADC_SPEC.referenceVoltageV / ADC_SPEC.codeLevels;
}

/**
 * Convert NTC divider ADC pin voltage to degrees Celsius.
 * Wiring: 3.3 V -- NTC -- sense node -- 1.5 kOhm -- AGND.
 * A 0 V or 3.3 V reading is indeterminate/saturated: return null.
 */
export function ntcVoltsToCelsius(senseVoltageV, betaK) {
  const { ntcSupplyVoltageV: supply, ntcBottomResistorOhm: bottom,
    ntcNominalResistanceOhm: r25, ntcReferenceTemperatureK: t25 } = NOMINAL_SENSING;

  if (!Number.isFinite(senseVoltageV) ||
      !(senseVoltageV > 0 && senseVoltageV < supply) ||
      !Number.isFinite(betaK) || betaK <= 0) {
    return null;
  }

  const ntcResistanceOhm = bottom * (supply / senseVoltageV - 1);
  if (!(ntcResistanceOhm > 0) || !Number.isFinite(ntcResistanceOhm)) return null;

  const reciprocalKelvin = 1 / t25 + Math.log(ntcResistanceOhm / r25) / betaK;
  if (!(reciprocalKelvin > 0) || !Number.isFinite(reciprocalKelvin)) return null;
  return 1 / reciprocalKelvin - 273.15;
}

/**
 * Convert a map of physical measurements, e.g. {vpv: 1234, tr1: 534}.
 * Omitted channels are null. `currentPolarity` must be determined by a known
 * positive-current test before signed current values can be trusted.
 * Allowed polarity values: +1 or -1 (both optional, default unconfirmed).
 *
 * Returns { values, quality, adcPinVoltageV }.
 * Quality NOMINAL_UNCALIBRATED means nominal conversion ONLY, not verified.
 */
export function convertAdcMeasurements(rawBySensor, options = {}) {
  const values = {};
  const quality = {};
  const adcPinVoltageV = {};
  const polarity = options.currentPolarity ?? {};
  const raw = rawBySensor && typeof rawBySensor === 'object' ? rawBySensor : {};

  for (const [name, spec] of Object.entries(SENSOR_SPEC)) {
    values[name] = null;
    adcPinVoltageV[name] = null;

    if (!Object.prototype.hasOwnProperty.call(raw, name) || raw[name] == null) {
      quality[name] = 'NOT_PROVIDED';
      continue;
    }

    const pinVolts = adcCountToVolts(raw[name]);
    if (pinVolts === null) {
      quality[name] = 'INVALID_RAW';
      continue;
    }
    adcPinVoltageV[name] = pinVolts;

    // Exact ADC rails cannot prove that a sensor isn't saturated or broken.
    if (raw[name] === ADC_SPEC.maxCount || (raw[name] === 0 && spec.kind !== 'voltage')) {
      quality[name] = 'ADC_RAIL';
      continue;
    }

    if (spec.kind === 'voltage') {
      values[name] = pinVolts / spec.voltsPerUnit;
    } else if (spec.kind === 'current') {
      const direction = polarity[name];
      if (direction !== 1 && direction !== -1) {
        quality[name] = 'CURRENT_DIRECTION_UNCONFIRMED';
        continue;
      }
      values[name] = direction *
        (pinVolts - NOMINAL_SENSING.currentZeroVoltageV) / spec.voltsPerUnit;
    } else if (spec.kind === 'ntc') {
      values[name] = ntcVoltsToCelsius(pinVolts, spec.betaK);
    }

    quality[name] = values[name] === null
      ? 'CONVERSION_INVALID'
      : 'NOMINAL_UNCALIBRATED';
  }

  return { values, quality, adcPinVoltageV };
}
