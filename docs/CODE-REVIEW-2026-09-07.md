# Revisión inicial del código — 7 de septiembre de 2026

Base: `fc07887` (importación inicial). Esta entrega prioriza autenticación; no certifica
la totalidad del POS ni sustituye pruebas de producción o de concurrencia Postgres.

## Corregido

- `demoLoginAction` aceptaba un correo sin contraseña/PIN en cualquier despliegue.
  Ahora solo permite cuentas demo conocidas en el entorno aislado. La protección
  está en el servidor, además de ocultar el acceso en la interfaz normal.
- Los PIN públicos compartidos quedan limitados al mismo entorno aislado.
- La sesión aceptaba una firma de desarrollo conocida si faltaba configuración.
  Ahora se exige una clave configurada de al menos 32 caracteres y se rechazan
  los ejemplos conocidos. Se validan expiración, identidad, rol y estructura del token.
- El acceso demo no comprobaba `active`. Ahora rechaza usuarios desactivados.
- La recuperación del usuario usaba ID **o** correo. Una cuenta recreada con el mismo
  correo podía heredar una sesión antigua. Ahora se busca exclusivamente el ID activo.
- La página de entrada verificaba solo la cookie: usuarios desactivados podían
  rebotar entre entrada y pantalla protegida. Ahora consulta el usuario vigente.

## Antes de integrar/desplegar

1. Configurar `SESSION_SECRET` aleatoria (mínimo 32 caracteres) y conservarla estable
   entre instancias. Rotarla cierra las sesiones previas.
2. Establecer contraseñas privadas para las cuentas reales. El seed y README contienen
   credenciales públicas; quitar botones demo no vuelve privadas esas contraseñas.
3. Verificar acceso por correo/contraseña con una cuenta administrativa activa.
   Los PIN 1111/2222/3333/4444 dejan de funcionar en despliegues normales.
4. No habilitar `MESA_ISOLATED_DEMO` en olive. Este flag también afecta fixtures/DB.
5. Revisar el despliegue separado: main ya contiene código y migraciones de Fase 6.
   No ejecutar el build personalizado contra la base productiva para validar este PR.

No se modificaron credenciales reales, datos, despliegues ni políticas Supabase.

## Verificación local

- `npm run test:auth`: OK. Invoca las acciones reales con DB/cookies simuladas:
  producción sin acceso demo, PIN inválido, usuario inactivo, login con contraseña,
  cuenta recreada, token manipulado/malformado/caducado, rotación y clave ausente.
- `node --import tsx scripts/phase3-roles.ts`: OK con SQLite aislado.
  Se usó este comando porque el CLI tsx no puede crear su socket IPC aquí.
- `npx next typegen` y `npx tsc --noEmit`: OK.
- `npx next build --webpack`: OK, sin ejecutar migraciones ni seed.
- Lint de archivos modificados: OK.
- Lint global: 8 errores y 2 advertencias en archivos ajenos a esta corrección.
  Incluyen funciones impuras/memoización en checkout-desk y efectos de estado en
  clock, menu-create-dialogs, order-entry y theme-toggle.

## Siguiente revisión prioritaria

- PIN personales y limitación persistente de intentos de login. No existe todavía
  protección distribuida contra intentos repetidos; no confundir esto con roles.
- El build personalizado ejecuta migraciones/seed y permite continuar si fallan.
  Separar despliegue de aplicación de migraciones aprobadas y fallar de forma clara.
- Revisar atomicidad y concurrencia de cobros, cierres, reservas y auditoría en Postgres.
  Las pruebas SQLite no demuestran el comportamiento entre instancias Vercel.
- Verificar permisos reales Supabase: el informe existente declara GRANT revocados,
  pero esta revisión no tuvo acceso a la base para comprobarlo.
- Resolver lint y después dividir `src/lib/ops.ts` por dominio con pruebas de regresión.
  Evitar una reescritura completa simultánea con cambios financieros.
