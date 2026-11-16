# Datos y recursos de terceros

| Recurso | Uso | Licencia |
|---|---|---|
| [Natural Earth](https://www.naturalearthdata.com) | Mapas reales (`src/mapas-reales.js`): países y lagos; ríos (`src/rios.js`) | Dominio público |
| [ETOPO5](https://www.ngdc.noaa.gov/mgg/global/etopo5.HTML), NOAA National Centers for Environmental Information | Mapas reales: altura del terreno (tipo de terreno y dibujo del relieve) | Dominio público (Gobierno de EE. UU.) |
| [flag-icons](https://github.com/lipis/flag-icons) © Panayiotis Lipiridis | Banderas de los países (`src/banderas.js`), y en `src/banderas-extra.js` los países que no salen en los mapas, Cataluña, Galicia, País Vasco, Canarias, Inglaterra, Escocia, Gales, Irlanda del Norte, la UE y la ONU | MIT, texto completo en `LICENCIA-flag-icons.txt` |
| [Wikimedia Commons](https://commons.wikimedia.org) | Banderas de las demás comunidades y ciudades autónomas, los territorios de Euskal Herria, la II República, banderas históricas y regiones (`src/banderas-extra.js`; los archivos, en `herramientas/banderas-extra.cjs`) | Símbolos oficiales y banderas históricas: dominio público |

Los ficheros se generan con los scripts de esta carpeta (`mapas.js`,
`banderas.cjs` y `banderas-extra.cjs`); el resto del juego es código y arte
propios.
