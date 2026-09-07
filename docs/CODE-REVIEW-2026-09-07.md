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
- Los pagos pendientes se incluían en el total aplicado y podían cerrar la cuenta
  antes de verificarse. Todos los saldos usan ahora únicamente pagos confirmados;
  al confirmar un pago se vuelve a calcular el estado y se genera el comprobante.
- La recuperación de cobros interrumpidos buscaba el ID dentro de una nota libre.
  Ahora `Payment.clientOpId` tiene una restricción única por cuenta y conserva una
  lectura compatible, con coincidencia exacta, para registros anteriores.
- Confirmar dos veces podía separar la actualización de la bitácora. La confirmación
  y su evento de auditoría se escriben en una sola transacción condicional.
- El servidor aceptaba una moneda diferente a la configurada para el método de pago.
  Ahora rechaza montos no finitos y combinaciones método/moneda incoherentes.
- El build continuaba si fallaba `prisma migrate deploy`, publicando potencialmente
  código incompatible con la base. Ahora una migración fallida detiene el deploy.

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
- Lint global: OK. Se eliminaron la inicialización impura del ID de cobro, cuatro
  memorizaciones/efectos de estado incompatibles con React Compiler y una advertencia.

## Siguiente revisión prioritaria

- PIN personales y limitación persistente de intentos de login. No existe todavía
  protección distribuida contra intentos repetidos; no confundir esto con roles.
- Revisar atomicidad y concurrencia de cobros, cierres, reservas y auditoría en Postgres.
  Las pruebas SQLite no demuestran el comportamiento entre instancias Vercel.
- Verificar permisos reales Supabase: el informe existente declara GRANT revocados,
  pero esta revisión no tuvo acceso a la base para comprobarlo.
- Dividir `src/lib/ops.ts` por dominio con pruebas de regresión, en cambios pequeños.
