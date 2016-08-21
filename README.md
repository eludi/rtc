# eludi rtc

realtime communication services for HTML5 games

## TODO

* add server timestamp to events
* chat example application: use MD5 hash for channel key and aes for message content
* CometSocket think about an optional guaranteed in-order message delivery
 
## Bugs
* 2 connected websockets, one is aborted by closing browser -> unhandled server exception
* client hosted on sufi, server on openshift, cometsocket -> CORS issue
