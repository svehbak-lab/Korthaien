import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Skriftene til butikkens temaer. Selvhostet gjennom @fontsource og ikke
// hentet fra Google: en butikkside skal ikke slutte å se riktig ut fordi et
// annet selskap har en dårlig dag, og kundene skal ikke måtte spørres om
// samtykke til et tredjepartskall for å lese en prisliste.
//
// Bare vektene som faktisk brukes. Hele familier ville lagt på et par hundre
// kilobyte for bokstaver ingen ser.
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/cinzel/700.css";

import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
