# Wii Balance Board weigh station

This service supports an original Nintendo `RVL-WBC-01` as an automatic rover
weigh station. The server installer builds the native bridge, grants only that
bridge `CAP_NET_ADMIN`, and installs a udev rule limited to the calibrated
Balance Board input device.

## Commissioning on the real server

1. Set `balanceBoard.enabled: true` in `server/config.yaml`.
2. Run `sudo ./install_server.sh` from the `server` directory. The installer
   configures BlueZ's Wii-compatible kernel HID mode, loads `hid-wiimote` now
   and at boot, and restarts Bluetooth and the rover server automatically.
3. Open the Activities tab. When it says **Waiting for red Sync**, press the red
   Sync button under the board's battery cover.
4. Wait for the card to report a paired bond and then **Ready**. BlueZ retains
   the bond and the service also stores the selected board address in
   `server/data/balance-board.json`.
5. For ordinary use, press only the front power button. The board should connect
   to the server without another Sync operation.

The bridge keeps Bluetooth Classic discovery active while no board is
commissioned and stops scanning after a successful bond. Once commissioned, it
actively retries the saved address while disconnected so a front-button wake is
caught even when the adapter does not accept the board's incoming reconnect.

Wii-family HID compatibility requires `UserspaceHID=false` and
`ClassicBondedOnly=false` in BlueZ's `input.conf`. The installer applies only
those two keys with an INI-aware tool and preserves unrelated Bluetooth input
settings. The latter relaxes BlueZ's global Classic HID bonding restriction;
this is limited to servers where Balance Board support is explicitly enabled.

## Physical station

Recess the board into a platform or place independent approach and departure
ramps beside it. A ramp that rests partly on the board and partly on the floor
will transfer some rover load to the floor and make the reading incorrect. At
the stable capture position, every wheel must be supported by the board itself.

## Verification

On the server, useful checks are:

```sh
getcap src/services/balanceBoardService/native/balance_board_worker
modinfo hid-wiimote
journalctl -u multirover.service -f
```

The capability check should report `cap_net_admin=ep`. When the board connects,
an input device named `Nintendo Wii Remote Balance Board` should appear under
`/dev/input` and the Activities card should begin receiving corner loads.

Test at least the following before treating the station as unattended:

- Ten front-button wake, measurement, drive-off, and idle-disconnect cycles.
- A server restart while the board is asleep.
- A server restart while the board is connected.
- A `bluetooth.service` restart followed by another front-button wake.
- Battery removal and replacement without removing the stored BlueZ bond.

Replacing the server Bluetooth adapter, erasing `/var/lib/bluetooth`, or using
**Forget board** invalidates the board's remembered host and requires the red
Sync commissioning step again.

## Development simulation

The native worker has a cycle simulator that never opens Bluetooth or input
devices:

```sh
BALANCE_BOARD_SIMULATE=cycle ./native/balance_board_worker
```

For a full local server/UI exercise, use a development config containing both
`balanceBoard.enabled: true` and `balanceBoard.simulate: true`. The public
example omits `simulate` because it is not a production hardware setting.
