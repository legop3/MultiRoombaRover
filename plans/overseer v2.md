# overseer v2 (will have a name rather than overseer.)
- name ideas:
  - allied mastercomputer
  - maybe it could rename itself? rarely?
  - AUTO
  - servermaster
  - LCARS
- current model is mistral-small:24b
  - currently runs at a pretty fast rate, about 30 seconds per tick
  - might need a larger model. one that supports tools
  - its probably okay if its a little slower after its all done
- the idea is to give the llm control over the room objects, 
  - like:
    - the neato
    - the lift
    - home assistant controls (they are all lights even if theyre switches)
    - button box rewards, maybe the llm is allowed to add some to the counts if it decides to
  - the idea is to use actual tools in ollama for it to be reliable, so need a model that supports tools.
- also, maybe using tools it could even have a small persistent memory database?
  - like, maybe it can store three lines of text, and it can read these and choose which one to replace with a tool.
- the way the llm would have to act to make this fun:
  - not too overbearing
  - like an ominous computer, not a generic helpful assistant
  - does things only when it can make them interesting
  - always responds to people, doesnt always listen and obey
  - doesnt talk on and on when no one wants to hear it


## for sure serious implimentation plans so far:
- replace the single "The Overseer" bot entry point in the chat system with:
  - a way for services to send bot messages to the chat system through the event bus, instead of it being fully internal with the chat system.
  - a simple bot: t/f flag in every chat message
    - so that people who are making spectator bots can just add a new bot: true field to their message emits and show up as a bot
- keep the old overseer, don't replace it with the new llm system. 
  - just change it a little to use the new bot chat message stuff.
- have a new admin debug UI for the new LLM system, in place of the old one (depending on which ones enabled in server config)