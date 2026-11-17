#!/usr/bin/env python3
"""One-time installed-host conversion. Never imported by roverd."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlparse


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout


def merge_known(target, source):
    # New defaults supply fields absent from old configs; explicit false survives.
    for key in target.keys() & source.keys():
        if isinstance(target[key], dict) and isinstance(source[key], dict):
            merge_known(target[key], source[key])
        else:
            target[key] = copy.deepcopy(source[key])


def convert(old, defaults, alsa, laptop, is_pi):
    result = copy.deepcopy(defaults)
    merge_known(result, old)
    if 'piGpio' not in old:
        gpio = result['piGpio']
        for key in ('brc', 'cameraServo', 'headlight', 'laser'):
            merge_known(gpio[key], old.get(key, {}))
        if gpio['brc']['gpioPin'] < 0:
            gpio['brc']['enabled'] = False
        gpio['enabled'] = is_pi and any(gpio[k]['enabled'] for k in ('brc', 'cameraServo', 'headlight', 'laser'))
    media = old.get('media', {})
    video = media.get('video', {})
    publisher = video.get('publisher')
    if publisher and publisher not in ('pi-libcamera', 'debian-laptop-v4l2'):
        raise ValueError(f'Custom publisher {publisher!r}: create a YAML profile before migrating')
    if 'profile' not in video:
        result['media']['video']['profile'] = {'pi-libcamera': 'rpicam', 'debian-laptop-v4l2': 'v4l2'}.get(publisher, 'rpicam' if is_pi and not laptop else 'v4l2')
    for category, known in [('video', ('video-publisher.service', 'debian-laptop-video-publisher.service')), ('audioCapture', ('audio-only-publisher.service',)), ('audioPlayback', ('audio-forward-listener.service',))]:
        service = media.get(category, {}).get('service')
        if service and service not in known:
            raise ValueError(f'Custom service {service!r}: convert its command to a profile first')
    aiy = 'googlevoicehat' in alsa
    for category in ('audioCapture', 'audioPlayback'):
        if 'profile' not in media.get(category, {}):
            result['media'][category]['profile'] = 'aiy' if aiy else 'alsa'
    # Old URLs were overridden by the old daemon too; endpoints now derive from
    # name/serverUrl. Preserve a nonstandard RTSP port when it is unambiguous.
    ports = set()
    for category, field in [('video', 'publishUrl'), ('audioCapture', 'publishUrl'), ('audioPlayback', 'forwardUrl')]:
        parsed = urlparse(media.get(category, {}).get(field, ''))
        if parsed.scheme == 'rtsp':
            suffix = {'video': '', 'audioCapture': '-audio', 'audioPlayback': '-fwd'}[category]
            expected_host = urlparse(result['serverUrl']).hostname
            if parsed.hostname != expected_host or parsed.path != '/' + result['name'] + suffix or parsed.query or parsed.username:
                raise ValueError(f'Custom {category} RTSP URL requires a custom profile')
            ports.add(parsed.port or 554)
        elif parsed.scheme == 'srt':
            print(f'{category}: replacing legacy SRT endpoint with server-derived RTSP')
        elif parsed.scheme:
            raise ValueError(f'Unsupported legacy stream transport: {parsed.scheme}')
    if 'rtspPort' not in media and ports:
        if len(ports) != 1:
            raise ValueError('Different legacy RTSP ports require a custom profile')
        result['media']['rtspPort'] = ports.pop()
    audio = result['audio']
    previous_audio = old.get('audio', {})
    if 'outputDevice' not in previous_audio:
        # The old installer wrote a dmixer hardware slave and a rovermic alias.
        mix = re.search(r'pcm\.dmixer\s*\{.*?slave\s*\{(.*?)\}', alsa, re.S)
        capture = re.search(r'pcm\.rovermic\s*\{.*?slave\.pcm\s+"([^"]+)"', alsa, re.S)
        card = re.search(r'name\s+"TTSMaster"\s+card\s+([^\s}]+)', alsa)
        if mix:
            device = re.search(r'pcm\s+"([^"]+)"', mix[1])
            rate = re.search(r'rate\s+(\d+)', mix[1])
            channels = re.search(r'channels\s+(\d+)', mix[1])
            fmt = re.search(r'format\s+(\S+)', mix[1])
            if not all((device, rate, channels, card)) or (fmt and fmt[1] != 'S16_LE'):
                raise ValueError('Unsupported host ALSA mixer; set explicit physical audio settings first')
            audio.update(outputDevice=device[1], mixerCard=card[1].strip('"'), outputSampleRate=int(rate[1]), outputChannels=int(channels[1]))
        elif alsa.strip():
            raise ValueError('Unrecognized /etc/asound.conf; cannot safely replace custom audio routing')
        elif laptop:
            audio.update(outputDevice=laptop['ROVERD_ALSA_PLAYBACK_DEVICE'], mixerCard=laptop['ROVERD_ALSA_PLAYBACK_CARD'], outputSampleRate=16000, outputChannels=1)
        else:
            raise ValueError('Cannot determine old physical playback device: /etc/asound.conf is missing')
        source = media.get('audioCapture', {}).get('device', previous_audio.get('captureDevice', 'rovermic'))
        if source in ('default', 'rovermic'):
            source = capture[1] if capture else laptop.get('ROVERD_ALSA_CAPTURE_DEVICE')
        if not source:
            raise ValueError('Cannot determine old microphone hardware device')
        audio['inputDevice'] = source
        # All playback now shares one hardware route. Do not silently discard
        # a deliberately different horn or forwarded-audio device.
        for device in (old.get('horn', {}).get('device'), media.get('audioPlayback', {}).get('device')):
            if device and device not in ('default', 'horn', 'forward', 'tts', audio['outputDevice']):
                raise ValueError(f'Separate playback device {device!r} needs an explicit routing choice')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, help='new architecture binary')
    parser.add_argument('--alsa-config', type=Path, default=Path('/etc/asound.conf'), help='legacy ALSA definitions for conversion')
    parser.add_argument('--source', type=Path, help='override legacy config path')
    parser.add_argument('--output', type=Path, help='write validated conversion only; do not alter host services')
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    if args.alsa_config != Path('/etc/asound.conf') and not args.output:
        raise ValueError('--alsa-config overrides require --output (preview only)')
    source = args.source or next((p for p in (Path('/etc/roverd.json'), Path('/etc/roverd.yaml')) if p.exists()), None)
    if source is None:
        print('No existing rover configuration to migrate')
        return
    current = subprocess.run([binary, '-config', str(source), '-check-config'], capture_output=True).returncode == 0
    defaults = json.loads(run(binary, '-print-default-config'))
    alsa_path = args.alsa_config
    alsa = alsa_path.read_text() if alsa_path.exists() else ''
    laptop = {}
    settings = Path('/etc/roverd-installer.env')
    if settings.exists():
        for line in settings.read_text().splitlines():
            if line.startswith('ROVERD_ALSA_') and '=' in line:
                key, value = line.split('=', 1)
                laptop[key] = value.strip().strip('\"\'')
    if current:
        converted = json.loads(source.read_text())
    else:
        import yaml
        # BaseLoader keeps sensor modes such as 1296:972 as strings. SafeLoader
        # provides normal booleans/numbers for all other schema fields.
        text = source.read_text()
        old = yaml.safe_load(text)
        if not isinstance(old, dict):
            raise ValueError('Legacy configuration must be an object')
        raw = yaml.load(text, Loader=yaml.BaseLoader)
        if 'sensorMode' in old.get('media', {}).get('video', {}):
            old['media']['video']['sensorMode'] = raw['media']['video']['sensorMode']
        model = Path('/proc/device-tree/model')
        is_pi = model.exists() and 'Raspberry Pi' in model.read_text()
        converted = convert(old, defaults, alsa, laptop, is_pi)
    units = ['video-publisher', 'debian-laptop-video-publisher', 'audio-only-publisher', 'audio-forward-listener']
    legacy = [Path('/etc/roverd.yaml'), settings, Path('/etc/sudoers.d/roverd-self-update'), Path('/var/lib/roverd/media.env'), Path('/var/lib/roverd/audio.pcm')]
    for unit in units:
        legacy += [Path(f'/etc/systemd/system/{unit}.service'), Path(f'/etc/systemd/system/{unit}.service.d'), Path(f'/usr/local/bin/{unit}')]
    # Recognize only installer-owned ALSA files, never delete arbitrary host routing.
    if alsa.startswith(('# Use the Google Voice HAT soundcard', '# Dedicated ALSA routing for the Debian laptop rover profile.', '# Reference ALSA routing for the Debian laptop rover profile.')):
        legacy.append(alsa_path)
    elif alsa.strip() and not current:
        raise ValueError('Custom ALSA file needs manual review before migration')
    if current and not args.output and not any(p.exists() for p in legacy):
        print('Current configuration already installed; migration not needed')
        return
    # Validate before stopping services or replacing any installed configuration.
    with tempfile.TemporaryDirectory(prefix='roverd-migrate-') as staging:
        candidate = Path(staging) / 'roverd.json'
        candidate.write_text(json.dumps(converted, indent=2) + '\n')
        os.chmod(candidate, 0o600)
        run(binary, '-config', str(candidate), '-check-config')
        if args.output:
            shutil.copyfile(candidate, args.output)
            os.chmod(args.output, 0o600)
            print(f'Validated configuration written to {args.output}')
            return
        if os.geteuid() != 0:
            raise ValueError('Host migration requires root')
        root = Path('/var/backups/roverd')
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        backup = Path(tempfile.mkdtemp(prefix='migration-', dir=root))
        paths = [source, Path('/usr/local/bin/roverd'), Path('/usr/local/bin/chromegtts-daemon'), Path('/etc/systemd/system/roverd.service'), Path('/etc/systemd/system/roverd.service.d'), Path('/etc/roverd-update.env'), Path('/usr/local/sbin/roverd-self-update'), *legacy]
        for path in dict.fromkeys(paths):
            if not path.exists() and not path.is_symlink():
                continue
            target = backup / str(path).lstrip('/')
            target.parent.mkdir(parents=True, exist_ok=True)
            if path.is_dir():
                shutil.copytree(path, target, symlinks=True)
            else:
                shutil.copy2(path, target, follow_symlinks=False)
        print(f'Previous installation saved in {backup}', flush=True)
        for unit in ['roverd', *units]:
            if run('systemctl', 'show', '-p', 'LoadState', '--value', unit + '.service').strip() != 'not-found':
                run('systemctl', 'stop', unit + '.service')
                if unit != 'roverd':
                    run('systemctl', 'disable', unit + '.service')
        for path in legacy + [Path('/etc/systemd/system/roverd.service.d')]:
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)
        target = Path('/etc/roverd.json')
        temporary = target.with_suffix('.json.migrating')
        shutil.copyfile(candidate, temporary)
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
        run('systemctl', 'daemon-reload')
        print('Migration complete; shared installer will install and start the new service')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        detail = getattr(error, 'stderr', '') or ''
        raise SystemExit(f'Migration stopped: {error}\n{detail}')
