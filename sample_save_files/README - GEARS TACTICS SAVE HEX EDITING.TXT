Install HxD - https://mh-nexus.de/en/hxd/
Make a manual backup before you start editing
(HxD makes one too but if you're doing multiple edits at a time, better safe than sorry)
Open the Program and drag and drop your save in there, 
always edit the last save of each slot 

EXAMPLE:
Classic slot 1 ="geargamesavegame_slot_1" 
Jacked slot 1 = "geargamesavegame_slot_41"


In the Editor, hit Ctrl + F and type in the callsign of your Unit (Make sure it's Unique)
after that hit Ctrl + F again -> "Health" and it will look something like this:
"Health.....IntProperty.........ô......."
(after IntProptery or FloatProperty is where the offsets will be)
The base offset for health is "F4 01" I changed mine to "F4 03" which puts the unit's health just above 1k
My Jack Unit has 65k which is "FF FF"
The rest of the stats are
Accuracy.....FloatProperty.........š™.?.... = 9A 99 19 3F - Change to 00 00 40 40 means your unit will never miss
MovementPoints.....IntProperty................. = 00 00 00 06 (sometimes it will be 07) - change it to 0f (25M) or 2f (50M).... or ff (255M)

I'm sure there are more edits that can be made, but this is just the basics for your own Soldiers.


Hope this helps
