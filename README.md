# eludi rtc

realtime communication services for HTML5 games

## TODO

* compact/clean up CometSocket receivedMsg record
* try auto-reconnect when back online -> monitor connection by an interval timer?
* be a little bit more verbose why a CometSocket connection is closed 1006, try to reconnect
* a dropped websocket connection is sometimes not reported to the peers
* add server timestamp to events
