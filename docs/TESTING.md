# Avouch Social: hands-on test checklist

Prod: https://avouchsocial.com. Use two accounts: **A** (host) and **B** (member), each in a different browser or private window. Check each step at phone width and at desktop width.

> **Blocker found 26 Oct 2026, 5:08 PM EDT:** every `/api/*` call on prod returns `503 {"error":"api-unavailable"}`. The pages load, but nothing that needs the server (signup and everything after it) works until the API is back.

## 1. Landing header and Sign in
1. Open avouchsocial.com logged out. **Expected:** the gold-framed door page appears, with "Sign in" at top right and the rooms listed under "Open the door" on desktop. There is no blank screen and no "Load the sample week" button.
2. Tap Sign in. **Expected:** the sign-in form opens, and the button is easy to tap on a phone.

## 2. Signup by invite code
1. Logged out, open the door and enter a test invite code with new details for A. **Expected:** the account is created and the board appears.
2. Repeat with the same code. **Expected:** it's rejected because the code is single-use.
3. Enter a made-up code. **Expected:** a clear error, and no account is created.
4. Sign up B with a second code. **Expected:** it works.

## 3. Rooms
1. As A, open the board. **Expected:** rooms are listed and the newest posts are at the top.
2. As B, open a room and post. **Expected:** A sees B's post after refreshing.

## 4. Gatherings, RSVP and roll call
1. As A, create a gathering in a room with a title, date, time and town. **Expected:** it shows on the board.
2. As B, RSVP Going, then change to Not going. **Expected:** A sees the count update each time.
3. As A, take roll for the gathering and mark B present. **Expected:** the roll saves and is still there after a reload.

## 5. Public /e/ gathering pages
1. As A (host), turn on sharing for the gathering and open its /e/ link logged out. **Expected:** you see only the title, date, town and a plain clock time. There are no names, no RSVPs, and no room or street details.
2. As a steward, try to turn sharing ON for someone else's gathering. **Expected:** you can't.
3. As a steward, turn sharing OFF. **Expected:** it works, and the /e/ link stops showing the gathering.
4. Open /e/ with a made-up ID. **Expected:** a not-found page, not a blank page.

## 6. End-to-end encrypted messages
1. As A, message B, and as B, reply. **Expected:** both see the thread.
2. As A, tap Sign out. **Expected:** a warning says signing out clears the message keys on this device, with the buttons "Sign out and clear" and Cancel. Cancel keeps you signed in.
3. Confirm the sign-out, then sign back in. **Expected:** the result matches the warning (old messages can't be read on this device).

## 7. Groups under More
1. Open More, then Groups. **Expected:** the groups list opens.
2. As A, ban B from a room. **Expected:** B can't read that room or its groups.

## 8. About page
1. Open More, then About. **Expected:** the mission text starts "Avouch exists so you can see what is happening in your community…". There's no "[OWNER TO WRITE]" placeholder, and the text is readable at body size.

## 9. Audience rooms (#49)
1. As an admin, open a room's settings and set an audience, for example women only. **Expected:** it saves.
2. As B, outside that audience, look at the board. **Expected:** the room and its posts aren't shown.

## 10. Sample week removed (#55)
1. On any board, look for a sample-week button or banner. **Expected:** there isn't one. The starter cards are still there.
2. Clear the local board. **Expected:** you must type the confirmation phrase first.

## Not live yet
- Admin stats page (#52): passed QA but isn't merged.
- Site-code signup cap (#50): blocked.
- Room categories (#51): waiting on a merge and an OK for its database change.
- MFA (0023): approved, being built.
