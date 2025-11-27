// Configuración centralizada de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js"
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js"
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js"

const firebaseConfig = {
  apiKey: "AIzaSyAO8WtFa4B4kOyT_XD3Z7Xj-lwEQcawHmY",
  authDomain: "ridersafe-fb9ae.firebaseapp.com",
  projectId: "ridersafe-fb9ae",
  storageBucket: "ridersafe-fb9ae.appspot.com",
  messagingSenderId: "502785631768",
  appId: "1:502785631768:web:40c593e2e207733a0e456d",
  measurementId: "G-GGJEHYDBLW",
}

// Inicializar Firebase
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)


export { app, auth, db }
