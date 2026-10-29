/**
 * Virtual ADC sensor-signal injection, not a PV/CLLC electrical plant model.
 * Conversions rely on nominal design parameters from sensorConversion.js.
 * Do not use these results to claim measured calibration or protection safety.
 */
import {
  ADC_SPEC,
  SENSOR_SPEC,
  NOMINAL_SENSING,
  convertAdcMeasurements,
} from '../model/sensorConversion.js';

export const SENSOR_INPUT_DEFAULTS = Object.freeze({
  vpv: 32, ipv: 20, vdc: 45, idc: 12,
  tr1: 40, tr2: 41, tr3: 42, m1: 45, m2: 46,
});

/** Convert a requested engineering-unit value into an ideal ADC pin voltage. */
export function idealAdcPinVoltage(sensorKey, physicalValue, currentPolarity = {}) {
  const spec = SENSOR_SPEC[sensorKey];
  if (!spec) return { voltageV: null, reason: 'UNKNOWN_SENSOR' };
  if (typeof physicalValue !== 'number' || !Number.isFinite(physicalValue)) {
    return { voltageV: null, reason: 'INVALID_INPUT' };
  }

  if (spec.kind === 'voltage') {
    return { voltageV: physicalValue * spec.voltsPerUnit, reason: null };
  }
  if (spec.kind === 'current') {
    const sign = currentPolarity[sensorKey];
    if (sign !== 1 && sign !== -1) {
      return { voltageV: null, reason: 'CURRENT_POLARITY_UNCONFIRMED' };
    }
    return {
      voltageV: NOMINAL_SENSING.currentZeroVoltageV +
        sign * physicalValue * spec.voltsPerUnit,
      reason: null,
    };
  }
  if (spec.kind === 'ntc') {
    const kelvin = physicalValue + 273.15;
    if (!(kelvin > 0)) return { voltageV: null, reason: 'INVALID_TEMPERATURE' };
    const resistanceOhm = NOMINAL_SENSING.ntcNominalResistanceOhm *
      Math.exp(spec.betaK *
        (1 / kelvin - 1 / NOMINAL_SENSING.ntcReferenceTemperatureK));
    const pinVoltageV = NOMINAL_SENSING.ntcSupplyVoltageV *
      NOMINAL_SENSING.ntcBottomResistorOhm /
      (NOMINAL_SENSING.ntcBottomResistorOhm + resistanceOhm);
    if (!Number.isFinite(pinVoltageV)) return { voltageV: null, reason: 'INVALID_NTC_MODEL' };
    return { voltageV: pinVoltageV, reason: null };
  }
  return { voltageV: null, reason: 'UNSUPPORTED_SENSOR_KIND' };
}

/**
 * Signal path: user physical value -> nominal analog sensor output ->
 * 12-bit ADC count -> existing firmware-style conversion function.
 * Out-of-ADC-range voltage is clipped to the nearest ADC rail and tagged.
 */
export function simulateAdcInjection(physicalBySensor, options = {}) {
  const rawBySensor = {};
  const idealPinVoltageV = {};
  const inputStatus = {};
  const currentPolarity = options.currentPolarity ?? {};
  const physical = physicalBySensor && typeof physicalBySensor === 'object'
    ? physicalBySensor : {};

  for (const sensorKey of Object.keys(SENSOR_SPEC)) {
    if (!Object.prototype.hasOwnProperty.call(physical, sensorKey) ||
        physical[sensorKey] === null || physical[sensorKey] === undefined) {
      inputStatus[sensorKey] = 'NOT_PROVIDED';
      continue;
    }
    const result = idealAdcPinVoltage(
      sensorKey, physical[sensorKey], currentPolarity
    );
    idealPinVoltageV[sensorKey] = result.voltageV;
    if (result.reason !== null) {
      inputStatus[sensorKey] = result.reason;
      continue;
    }

    const clipped = Math.min(
      ADC_SPEC.referenceVoltageV,
      Math.max(0, result.voltageV)
    );
    rawBySensor[sensorKey] = Math.round(
      clipped * ADC_SPEC.maxCount / ADC_SPEC.referenceVoltageV
    );
    inputStatus[sensorKey] = result.voltageV < 0 ||
      result.voltageV > ADC_SPEC.referenceVoltageV
      ? 'ADC_INPUT_CLIPPED'
      : 'IN_RANGE';
  }

  const converted = convertAdcMeasurements(rawBySensor, { currentPolarity });
  const quality = { ...converted.quality };
  for (const [sensorKey, status] of Object.entries(inputStatus)) {
    if (status !== 'IN_RANGE') quality[sensorKey] = status;
  }

  return {
    rawBySensor,
    idealPinVoltageV,
    adcPinVoltageV: converted.adcPinVoltageV,
    values: converted.values,
    quality,
    inputStatus,
  };
}
