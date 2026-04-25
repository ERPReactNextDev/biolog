import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth"
; // Idagdag ito

const firebaseConfig = {
  apiKey: "AIzaSyCNonSOohWCFdgL052XUFFZTH1orbP2dH4",
  authDomain: "taskflow-4605f.firebaseapp.com",
  projectId: "taskflow-4605f",
  storageBucket: "taskflow-4605f.firebasestorage.app",
  messagingSenderId: "558742255762",
  appId: "1:558742255762:web:5725b5c26f1c6fae9e8e4b",
  measurementId: "G-9J1LXQ8YZC",
};

const app = !getApps()?.length ? initializeApp(firebaseConfig) : getApps()?.[0];

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app); // I-export ito para sa Auth page