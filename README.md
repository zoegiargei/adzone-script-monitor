# adzone-script-monitor

Monitoreo liviano y alertas tempranas ante cambios inesperados en scripts remotos de AdZone, basado en la detección de versión y timestamp desde el header del archivo JavaScript.

Se implementa esta POC para detectar modificaciones en scripts de AdZone sin necesidad de descargar el archivo completo.

---

## Contexto / Problema

En múltiples ocasiones, los anuncios dejaron de visualizarse correctamente debido a cambios inesperados en los scripts remotos de AdZone.  
Estas modificaciones ocurrieron sin notificación previa y afectaron tanto la funcionalidad como la experiencia de usuario.

Dado que los scripts se cargan dinámicamente desde URLs externas, los cambios no fueron detectados hasta que el problema ya estaba en producción.


## Enfoque

Este spike implementa una **primera capa de detección** que:

- Descarga únicamente los **primeros bytes** del script utilizando HTTP `Range`
- Extrae la **versión** y la **fecha de generación** desde comentarios del header, por ejemplo:
  ```js
  // v 255
  // 2026-Jan-14 09:53:31

- Guarda un estado de referencia local
- Detecta cambios comparando la metadata actual con la anterior
- Emite alertas (por consola, extensible a Slack o email)


## Requisitos

- Node.js 18 o superior
- Acceso de red a s1.adzonestatic.com


## Configuración Inicial

1. git clone https://github.com/<org>/adzone-script-monitor.git
2. cd adzone-script-monitor
3. npm install


## Para probar

Ejecutar el script de detección por header:
`<node scripts/check-adzone-header.mjs>`

### Primera Ejecución

- No existe estado previo
- Se genera un baseline en state/*.header.json
- Ejemplo de salida: `[AdZoneGuard][tn] baseline guardado v=255 date=2026-Jan-14 09:53:31`

### Ejecuciones Posteriores

- Se compara la versión y fecha actuales contra el baseline
- Ejemplo de salida sin cambios detectados: `[AdZoneGuard][tn] CAMBIO DETECTADO
prev: v=255 date=2026-Jan-14 09:53:31
next: v=256 date=2026-Jan-15 08:12:02`
- Ejemplo de salida con cambios detectados: `[AdZoneGuard][tn] CAMBIO DETECTADO
prev: v=255 date=2026-Jan-14 09:53:31
next: v=256 date=2026-Jan-15 08:12:02`

---

## Consideraciones y Limitaciones

Esta capa depende de que AdZone mantenga actualizada la versión y fecha en el header del script

Si el archivo cambia sin modificar esa metadata, este mecanismo no lo detectará
