# 올라가조 PV-CLLC: Telemetry protocol v1

**Status:** test harness implemented; MCU serial transmit is **NOT implemented** in ADC v2.2.1.

`schema`: `pvcllc.telemetry.v1`. One UTF-8 JSON object per newline from a future MCU UART transmitter, or the same JSON object as an SSE `telemetry` event from the PC bridge.

```json
{
  "schema": "pvcllc.telemetry.v1",
  "boardId": "BOARD-01",
  "source": "PC_TEST",
  "timestampMs": 1793280000000,
  "sampleCount": 2000,
  "adcDataValid": true,
  "adcTimeoutCount": 0,
  "adcOverflowCount": 0,
  "rawBySensor": {
    "vpv": 3100, "ipv": 2600, "m1": 2200, "m2": 2210,
    "idc": 2550, "vdc": 3190, "tr1": 2200, "tr2": 2210, "tr3": 2220
  },
  "pwmEnabled": false,
  "switchingFrequencyHz": null
}
```

## Fixed 9-channel ADC map (physical ADC input, not SOC number)

| Key | F28388D ADC pin | SOC | Firmware variable |
|---|---|---|---|
| `vpv` | ADCA3 | ADCA SOC0 | `adcVpvRaw` |
| `ipv` | ADCA2 | ADCA SOC1 | `adcIpvRaw` |
| `m1` | ADCA4 | ADCA SOC2 | `adcM1Raw` |
| `m2` | ADCA5 | ADCA SOC3 | `adcM2Raw` |
| `idc` | ADCD0 | ADCD SOC0 | `adcIdcRaw` |
| `vdc` | ADCD1 | ADCD SOC1 | `adcVdcRaw` |
| `tr1` | ADCD2 | ADCD SOC2 | `adcTR1Raw` |
| `tr2` | ADCD3 | ADCD SOC3 | `adcTR2Raw` |
| `tr3` | ADCD4 | ADCD SOC4 | `adcTR3Raw` |

The existing website nominal ADC conversion divides by 4095 while current CCS v2.2.1 pin-voltage conversion divides by 4096; this known scale discrepancy must be reconciled before calibrated hardware comparison. The sensor assumptions are in `src/model/sensorConversion.js`. This is *not* confirmed sensor calibration. Current direction +1 is a **bench-test assumption** only for browser demo and PC_TEST frames; MCU_UART data retain unknown current polarity and the web will not treat those currents as verified until calibration. PWM / MPPT / PFM are not enabled by these demos.

The bridge adds `source="MCU_UART"` only when a local serial port physically supplies a valid line; the MCU firmware must implement that output and undergo physical testing before claiming this is actual live telemetry.

## Security/limitations

- The bridge listens only on 127.0.0.1:8765, accepts GET requests to `/health` and `/events`, and uses an allowlist of browser origins.
- `PC_TEST` is fake data and is never a reliable MCU measurement.
- `MCU_UART` represents a received serial JSON line; correctness, sensor calibration, and control safety still require instrumentation testing.
- GitHub Pages itself is static. It cannot directly execute CCS firmware or expose a local serial port to every teammate.
