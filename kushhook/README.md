# Kushhook: step 1

1. console.firebase.google.com > create a project > add a Web app.
2. Paste its config into public/config.js.
3. Authentication > Sign-in method > enable Google.
4. Firestore Database > create (production mode). In Rules, paste firestore.rules and Publish.
5. Test: open the folder in VS Code and run:  npx serve public   (use the localhost address)
6. Odds posting (you only): sign in, copy your User UID from Authentication > Users,
   then in Firestore create collection "admins" with a document whose ID is that UID. Reload.
7. Go live:  npx firebase-tools login
             npx firebase-tools deploy --project YOUR_PROJECT_ID
   (this also publishes firestore.rules)
