// Representative get_services responses, with HA-resolved feature masks and
// selector shapes. Domains intentionally differ so tests exercise discovery,
// not a pre-existing table of supported entity classes.
const target = (domain, supported_features) => ({ entity: { domain, ...(supported_features ? { supported_features } : {}) } });
const field = (selector, extra = {}) => ({ selector, ...extra });
const action = (domain, fields = {}, supported_features) => ({ target: target(domain, supported_features), fields });
const power = (domain) => ({ turn_on: action(domain), turn_off: action(domain), toggle: action(domain) });
const services = {
  fan: {
    ...power('fan'),
    set_percentage: action('fan', { percentage: field({ number: { min: 0, max: 100, unit_of_measurement: '%' } }, { required: true }) }, [1]),
    oscillate: action('fan', { oscillating: field({ boolean: {} }, { required: true }) }, [2]),
    set_direction: action('fan', { direction: field({ select: { options: ['forward', 'reverse'] } }, { required: true }) }, [4]),
    set_preset_mode: action('fan', { preset_mode: field({ state: { attribute: 'preset_mode' } }, { required: true }) }, [8]),
  },
  climate: {
    ...power('climate'),
    set_temperature: action('climate', {
      temperature: field({ number: { min: 0, max: 250, step: 0.1 } }, { filter: { supported_features: [1] } }),
      temperature_range: { fields: {
        target_temp_high: field({ number: { min: 0, max: 250, step: 0.1 } }, { filter: { supported_features: [2] } }),
        target_temp_low: field({ number: { min: 0, max: 250, step: 0.1 } }, { filter: { supported_features: [2] } }),
      } },
      hvac_mode: field({ state: { hide_states: ['unknown', 'unavailable'] } }),
    }, [1, 2]),
    set_hvac_mode: action('climate', { hvac_mode: field({ state: {} }) }),
    set_fan_mode: action('climate', { fan_mode: field({ state: { attribute: 'fan_mode' } }, { required: true }) }, [8]),
  },
  cover: {
    open_cover: action('cover', {}, [1]), close_cover: action('cover', {}, [2]), stop_cover: action('cover', {}, [8]),
    set_cover_position: action('cover', { position: field({ number: { min: 0, max: 100 } }, { required: true }) }, [4]),
  },
  media_player: {
    ...power('media_player'),
    volume_set: action('media_player', { volume_level: field({ number: { min: 0, max: 1, step: 0.01 } }, { required: true }) }, [4]),
    volume_mute: action('media_player', { is_volume_muted: field({ boolean: {} }, { required: true }) }, [8]),
    media_play_pause: action('media_player', {}, [[1, 16384]]),
    select_source: action('media_player', { source: field({ state: { attribute: 'source' } }, { required: true }) }, [2048]),
    play_media: action('media_player', { media: field({ media: {} }, { required: true }) }, [512]),
  },
  vacuum: {
    start: action('vacuum', {}, [8192]), return_to_base: action('vacuum', {}, [16]),
    set_fan_speed: action('vacuum', { fan_speed: field({ state: { attribute: 'fan_speed' } }, { required: true }) }),
  },
  light: {
    ...power('light'),
    turn_on: action('light', {
      brightness_pct: field({ number: { min: 0, max: 100 } }, { filter: { attribute: { supported_color_modes: ['brightness', 'rgb', 'color_temp'] } } }),
      rgb_color: field({ color_rgb: {} }, { filter: { attribute: { supported_color_modes: ['rgb', 'hs'] } } }),
      color_temp_kelvin: field({ color_temp: { min: 2000, max: 6500, unit: 'kelvin' } }, { filter: { attribute: { supported_color_modes: ['color_temp'] } } }),
    }),
  },
  switch: power('switch'),
  number: { set_value: action('number', { value: field({ text: {} }, { required: true }) }) },
  input_number: { set_value: action('input_number', { value: field({ number: { min: 0, max: 9223372036854775807 } }, { required: true }) }) },
  text: { set_value: action('text', { value: field({ text: {} }, { required: true }) }) },
  select: { select_option: action('select', { option: field({ state: {} }, { required: true }) }) },
  button: { press: action('button') },
  input_datetime: { set_datetime: action('input_datetime', { datetime: field({ datetime: {} }) }) },
  // Discovery must also work for integration-defined actions/domains. The
  // cross-domain action has an explicit target while global reload does not.
  custom: {
    adjust: action('custom', { level: field({ number: { min: -5, max: 5 } }, { required: true }), mode: field({ select: { options: [{ value: 'eco', label: 'Economy' }] } }, { required: true }) }),
    reload: { fields: {} },
    fan_reset: action('fan'),
  },
};
module.exports = { services };
