# Roverd configuration and management

Roverd now reads `/etc/roverd.json`. YAML settings are no longer accepted. Repository samples and installer paths use JSON; there is no configuration migration or legacy reader.

The schema is generated from the Go configuration types. Both configuration files and remote submissions must contain the complete object. Derived media URLs are excluded from saved settings and still included in control hello metadata.

## Local configuration commands

These commands do not open hardware, start media, or connect to the server:

```sh
./dist/roverd-linux-amd64 -print-default-config
./dist/roverd-linux-amd64 -print-config-schema
./dist/roverd-linux-amd64 -config rover/roverd/roverd.sample.json -check-config
```

Select the appropriate architecture binary on a rover. The default object supplies initial values; edit the name and server URL before installing it. The initial serial path may need configuration for the actual hardware.

## Connections and state

- `/rover`: control commands, acknowledgements, sensors, and complete `roverState` snapshots.
- `/rover/management`: configuration hello, management commands/acknowledgements, host statistics, and daemon events.
- Derive the management address from the configured `ws://host[:port]/rover` or `wss://host[:port]/rover` control URL; there is no second server address to maintain.
- Management starts independently of hardware initialization and remains available after serial/peripheral startup failure.
- Control disconnect docking/reboot behavior still depends on control connectivity. A live management connection does not count as a working control connection.
- The server maintains management records independently of the control roster, only in memory. Management disconnect removes the record; hello repopulates it.
- Profile catalogs and current media status arrive in hello; see [media profiles](rover-media-profiles.md).

## Configuration page

Open `/admin?section=fleet` as an admin or lockdown admin. Select a management-connected rover, edit its schema-driven form, and use “Save to this rover”. For a fleet change, select the field below the form and use “Apply this field to all rovers”; its value comes from the current draft. Review individual results. Offline rovers are not queued.

## Admin Socket.IO API

Each request receives a callback containing either `{ success: true, ...result }` or `{ error: "..." }`. Authorization uses the existing admin/lockdown-admin role check.

| Event | Payload | Result |
| --- | --- | --- |
| `roverManagement:list` | `{}` | `rovers`, including management-only rovers |
| `roverManagement:get` | `{ roverId }` | Current configuration, schema, profiles, host statistics, recent notices |
| `roverManagement:save` | `{ roverId, config }` | Request ID after roverd acknowledges the complete object |
| `roverManagement:applyField` | `{ path: ["piGpio", "enabled"], value: false }` | Individual `results` containing rover ID, success/error, and successful request ID |
| `roverManagement:command` | `{ roverId, type, reboot?, media? }` | Request ID after acknowledgement; types are `reboot`, `update`, `media` |

Admin notifications are `roverManagement:changed`, `roverManagement:offline`, `roverManagement:hostStats`, and `roverManagement:event`. Requests time out if no acknowledgement arrives. Disconnect before acknowledgement reports an unknown outcome as an error; reconnect and read the actual configuration rather than assuming it was not saved.

The existing reboot/update UI paths use management delivery and retain `commandAck` notifications. The separate user “reboot my rover” permission/cooldown checks remain in place. Generic media-management commands now require admin privileges.

## Save lifecycle

1. Validate the complete JSON object against the schema and existing semantic checks.
2. Block new control commands and stop motion when a control runtime exists.
3. Write and sync a temporary file, then atomically replace the configuration file with mode `0600`.
4. Attempt the acknowledgement, cancel the daemon runtime, and release hardware resources.
5. Re-execute roverd, reload the saved file, and send a new management hello.

Once the file has been replaced, roverd restarts even if the acknowledgement cannot be delivered. The server does not optimistically overwrite its cached configuration. Invalid submissions leave the file untouched.

## Deployment verification still required

Do this on the intended server/rover, not the development machine:

1. Deploy the changed server and the matching rover binary/config together. Capture `journalctl -u roverd -f` and server logs.
2. With an authenticated admin Socket.IO session, call `roverManagement:list` and `roverManagement:get`. Expect configuration and schema even when the rover's serial device cannot open.
3. Change a harmless setting such as description in the returned full object and call `roverManagement:save`. Expect an acknowledgement, disconnect/reconnect, and a new hello containing that setting. Confirm `/etc/roverd.json` matches and survives a service restart.
4. Submit an incomplete object. Expect an error, no file replacement, and no restart.
5. Confirm host statistics and autocharge/watchdog/daemon notices still reach their existing UI/alert consumers through management. Headlight/laser state must arrive as a complete `roverState` snapshot on control.
6. Verify reboot/update requests use management, the normal user reboot restrictions still apply, and non-admin clients cannot read/save configuration or invoke the admin command endpoint.
7. Confirm new movement commands cannot execute while a save/reboot/update is stopping the rover, and that control disconnect safety still works independently of management.

Record acknowledgement errors, reconnect hello contents, relevant journal/server output, and physical stop behavior in the implementation tracker. Do not treat CLI validation or compilation as evidence of these deployed flows.

## Pending stages

YAML media catalogs, child supervision, shared ALSA routing, and Fleet Management profile controls are implemented. Browser/live verification of configuration, operational state, media, and audio remains pending. Standalone bootstrap and shared self-update are implemented; host verification remains pending. See [installation and updates](roverd-installation.md). Update status is included as `updateStatus` in hello and sent as `{type: "updateStatus", status: {state, message, timestamp}}` when it changes.

Apply-field targets the currently management-connected fleet. It clones each rover’s own configuration, replaces an existing field, and sends the complete object for rover-side validation. Inspect individual results for failures. Missing fields and changed connections are reported; offline changes are not queued. Paths traverse object fields, not array elements. Array-valued fields can be replaced as a whole.

Control state messages have the shape `{ "type": "roverState", "state": { "headlightOn": false, "laserOn": null } }`. Null indicates an unavailable role. Each message replaces the server object; disconnect clears it. The roster exposes `roverState` directly, rather than per-device `state` objects.
