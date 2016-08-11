# eludi rtc

realtime communication services for HTML5 games

## TODO

* redirect on OpenShift from port 80 to port 8000
* sometimes comet socket delivers an event twice -> add msgid, discard if too low?
* try auto-reconnect when back online -> monitor connection by an interval timer?
* be a little bit more verbose why a CometSocket connection is closed 1006
* a dropped websocket connection is not reported to the peers
* add server timestamp to events