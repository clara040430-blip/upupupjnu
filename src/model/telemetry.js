
export const BOARD_IDS = [
  'BOARD-01',
  'BOARD-02',
  'BOARD-03',
  'BOARD-04',
];

export const SENSOR_GROUPS = [
  {
    title: '전압 및 전류',
    channels: [
      { key: 'vpv', label: 'PV 입력전압', unit: 'V' },
      { key: 'ipv', label: 'PV 입력전류', unit: 'A' },
      { key: 'vdc', label: 'DC 출력전압', unit: 'V' },
      { key: 'idc', label: 'DC 출력전류', unit: 'A' },
    ],
  },
  {
    title: '변압기 온도',
    channels: [
      { key: 'tr1', label: 'Transformer 1', unit: '°C' },
      { key: 'tr2', label: 'Transformer 2', unit: '°C' },
      { key: 'tr3', label: 'Transformer 3', unit: '°C' },
    ],
  },
  {
    title: 'MOSFET 온도',
    channels: [
      { key: 'm1', label: 'MOSFET 1', unit: '°C' },
      { key: 'm2', label: 'MOSFET 2', unit: '°C' },
    ],
  },
];

export function createEmptyBoard(id) {
  const measurements = {};

  for (const group of SENSOR_GROUPS) {
    for (const channel of group.channels) {
      measurements[channel.key] = null;
    }
  }

  return {
    id,
    connection: 'DISCONNECTED',
    source: 'NONE',
    timestamp: null,
    measurements,
    control: {
      switchingFrequencyHz: null,
      ppoAction: null,
      ppoPhase: null,
      iaaDeltaHz: null,
    },
    protection: {
      state: 'UNKNOWN',
      faultCode: null,
    },
  };
}
