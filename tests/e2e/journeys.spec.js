// Recorridos principales en un navegador real contra el servidor real (base de datos temporal).
// Los montos son datos de prueba y viven solo en esa base temporal.
import { test, expect, devices } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = { name: 'Ana Admin', email: 'ana@example.test', password: 'contrasena-ana-1' };
const MEMBER = { name: 'Beto Integrante', email: 'beto@example.test', password: 'contrasena-beto-1' };
let inviteLink;

async function login(page, user) {
  await page.goto('/login');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.greeting')).toBeVisible();
}

test('1. crear el espacio y la cuenta de administración', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Bienvenido/ })).toBeVisible();
  await page.locator('input[autocomplete=name]').fill(ADMIN.name);
  await page.locator('input[type=email]').fill(ADMIN.email);
  await page.locator('input[type=password]').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Crear espacio' }).click();
  await expect(page.locator('.greeting')).toContainText('Ana');
  await expect(page.getByText('Primeros pasos')).toBeVisible();
});

test('2. errores de inicio de sesión se explican y la sesión persiste al recargar', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill(ADMIN.email);
  await page.locator('#password').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos');
  await login(page, ADMIN);
  await page.reload();
  await expect(page.locator('.greeting')).toBeVisible();
});

test('3. invitar a un integrante y que acepte la invitación', async ({ page, browser }) => {
  await login(page, ADMIN);
  await page.goto('/members');
  await page.getByRole('button', { name: 'Invitar' }).click();
  await page.locator('.modal input[type=email]').fill(MEMBER.email);
  await page.locator('.modal select').selectOption({ label: 'Integrante' });
  await page.getByRole('button', { name: 'Crear invitación' }).click();
  await expect(page.getByText('no se envió ningún correo')).toBeVisible();
  inviteLink = await page.locator('.modal input[readonly]').inputValue();
  expect(inviteLink).toContain('/invite/');

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(inviteLink);
  await expect(p2.getByText('Te invitaron como')).toBeVisible();
  await p2.locator('input[autocomplete=name]').fill(MEMBER.name);
  await p2.locator('input[type=password]').fill(MEMBER.password);
  await p2.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(p2.locator('.greeting')).toContainText('Beto');
  // El enlace no se puede reutilizar.
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto(inviteLink);
  await expect(p3.getByText('Invitación no disponible')).toBeVisible();
  await ctx.close();
});

test('4. proyecto desde plantilla, arrastrar una tarjeta y verla igual en todas las vistas', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Nuevo proyecto' }).first().click();
  await page.getByText('Lanzamiento de producto').click();
  await page.locator('#pname').fill('Línea de macetas');
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await page.locator('.tab', { hasText: 'Tablero' }).click();
  const card = page.locator('.board-card', { hasText: 'Diseño de marca y empaque' });
  await expect(card).toBeVisible();

  // Arrastrar a "En progreso" con el ratón (dnd-kit).
  const target = page.locator('.board-col', { hasText: 'En progreso' }).locator('.col-body');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + ((to.x + 40 - from.x) * i) / 12, from.y + ((to.y + 30 - from.y) * i) / 12);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect(page.locator('.board-col', { hasText: 'En progreso' }).locator('.board-card', { hasText: 'Diseño de marca y empaque' })).toBeVisible();

  // Persistió en el servidor: tras recargar sigue en la columna y la vista de lista muestra el estado.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.board-col', { hasText: 'En progreso' }).locator('.board-card', { hasText: 'Diseño de marca y empaque' })).toBeVisible();
  await page.locator('.tab', { hasText: 'Lista' }).click();
  const group = page.locator('.group-head', { hasText: 'En progreso' });
  await expect(group).toBeVisible();
  await expect(page.locator('.task-row', { hasText: 'Diseño de marca y empaque' })).toBeVisible();
  await page.locator('.tab', { hasText: 'Tabla' }).click();
  await expect(page.locator('tr', { hasText: 'Diseño de marca y empaque' })).toContainText('En progreso');
});

test('5. asignar una tarea con fecha: la persona la ve y recibe notificación', async ({ page, browser }) => {
  await login(page, ADMIN);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Nueva tarea' }).click();
  await page.getByPlaceholder('¿Qué hay que hacer?').fill('Pedir cotización de barro');
  // Responsables: quitar a Ana y agregar a Beto
  await page.locator('.modal .props .prop-btn').nth(1).click();
  await page.locator('.menu .menu-item', { hasText: 'Ana Admin' }).click();
  await page.locator('.menu .menu-item', { hasText: 'Beto Integrante' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Crear tarea' }).click();
  await expect(page.getByText('Tarea creada')).toBeVisible();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, MEMBER);
  await expect(p2.locator('.task-row', { hasText: 'Pedir cotización de barro' })).toBeVisible();
  await p2.goto('/notifications');
  await expect(p2.getByText('Ana Admin te asignó «Pedir cotización de barro»')).toBeVisible();
  // Completar desde su lista
  await p2.goto('/tasks');
  const row = p2.locator('.task-row', { hasText: 'Pedir cotización de barro' });
  await row.locator('.task-check').click();
  await expect(row).toHaveClass(/is-done/);
  await ctx.close();
});

test('6. chat en tiempo real entre dos personas', async ({ page, browser }) => {
  await login(page, ADMIN);
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, MEMBER);
  await p2.goto('/chat');
  await expect(p2.locator('.chat-head')).toContainText('General');

  await page.goto('/chat');
  await page.locator('.chat-composer textarea').fill('¿Quién va a la feria el sábado? @Beto');
  await page.keyboard.press('Escape');
  await page.locator('.chat-composer textarea').press('Enter');
  await expect(page.locator('.msg-text', { hasText: 'feria el sábado' })).toBeVisible();

  // Llega sin recargar (Server-Sent Events)
  await expect(p2.locator('.msg-text', { hasText: 'feria el sábado' })).toBeVisible({ timeout: 8000 });
  // y se conserva al recargar
  await p2.reload();
  await expect(p2.locator('.msg-text', { hasText: 'feria el sábado' })).toBeVisible();
  await ctx.close();
});

test('7. documento con guardado automático que persiste y se vincula a un proyecto', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/docs');
  await page.getByRole('button', { name: /Página en blanco/ }).click();
  await page.locator('.doc-title').fill('Acuerdos entre socios');
  await page.locator('.bn-editor').click();
  await page.keyboard.type('Las decisiones se toman por mayoría.');
  await expect(page.locator('.save-state')).toContainText('Guardado', { timeout: 8000 });
  const url = page.url();
  await page.getByText('Vincular a un proyecto').click();
  await page.locator('.menu .menu-item', { hasText: 'Línea de macetas' }).click();
  await expect(page.locator('.doc-meta')).toContainText('Línea de macetas');
  await page.goto(url);
  await expect(page.locator('.doc-title')).toHaveValue('Acuerdos entre socios');
  await expect(page.locator('.bn-editor')).toContainText('Las decisiones se toman por mayoría.');
  // Aparece en la pestaña Documentos del proyecto
  await page.goto('/projects');
  await page.getByText('Línea de macetas').first().click();
  await page.locator('.tab', { hasText: 'Documentos' }).click();
  await expect(page.locator('.list-row', { hasText: 'Acuerdos entre socios' })).toBeVisible();
  // Búsqueda global por contenido
  await page.keyboard.press('Control+k');
  await page.keyboard.type('mayoria');
  await expect(page.locator('.palette-item', { hasText: 'Acuerdos entre socios' })).toBeVisible();
});

test('8. finanzas: registrar movimientos y verificar los cálculos', async ({ page }) => {
  await login(page, ADMIN);
  const record = async (kind, amount, concept) => {
    await page.goto('/finance/movements');
    await page.getByRole('button', { name: kind === 'income' ? 'Ingreso' : 'Gasto', exact: true }).first().click();
    await page.locator('#tx-amount').fill(amount);
    await page.locator('.modal input[placeholder^="Ej."]').first().fill(concept);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Movimiento registrado')).toBeVisible();
  };
  await record('income', '1000', 'Venta de prueba');
  await record('expense', '250.50', 'Compra de prueba');
  await page.goto('/finance/overview');
  const stat = (label) => page.locator('.stat').filter({ has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) }).locator('.value');
  await expect(stat('Ingresos')).toHaveText('$1,000.00');
  await expect(stat('Gastos')).toHaveText('$250.50');
  await expect(stat('Balance del periodo')).toHaveText('$749.50');
  await expect(stat('Saldo en cuentas')).toHaveText('$749.50');

  // Anular con motivo excluye el movimiento de los totales
  await page.goto('/finance/movements');
  await page.locator('tr', { hasText: 'Compra de prueba' }).click();
  await page.getByRole('button', { name: 'Anular' }).click();
  await page.locator('.modal textarea').fill('Prueba de anulación');
  await page.locator('.modal').getByRole('button', { name: 'Anular' }).click();
  await expect(page.getByText('Movimiento anulado')).toBeVisible();
  await page.goto('/finance/overview');
  await expect(stat('Gastos')).toHaveText('$0.00');
  await expect(stat('Balance del periodo')).toHaveText('$1,000.00');
});

test('9. permisos: un integrante no ve las finanzas completas ni la configuración', async ({ page }) => {
  await login(page, MEMBER);
  await page.goto('/finance');
  await expect(page).toHaveURL(/\/finance\/movements/);
  await expect(page.locator('.tab', { hasText: 'Resumen' })).toHaveCount(0);
  await expect(page.getByText('Ves solo tus movimientos')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Venta de prueba' })).toHaveCount(0);
  await page.goto('/finance/overview');
  await expect(page).toHaveURL(/\/finance\/movements/);
  await page.goto('/settings');
  await expect(page.locator('.sb-item', { hasText: 'Espacio de trabajo' })).toHaveCount(0);
  await page.goto('/settings/roles');
  await expect(page.locator('.perm-table input[type=checkbox]').first()).toBeDisabled();
  // El inicio no muestra el resumen financiero
  await page.goto('/');
  await expect(page.locator('.card-head', { hasText: 'Finanzas' })).toHaveCount(0);
});

test('10. reunión con acuerdo y decisión que requiere aprobación', async ({ page, browser }) => {
  await login(page, ADMIN);
  await page.goto('/meetings');
  await page.getByRole('button', { name: 'Nueva reunión' }).click();
  await page.locator('.modal input').first().fill('Reunión semanal');
  await page.locator('.modal').getByRole('button', { name: 'Programar', exact: true }).click();
  await expect(page.locator('.page-title')).toHaveText('Reunión semanal');
  await page.getByPlaceholder(/Nuevo acuerdo/).fill('Reservar lugar en la feria');
  await page.getByRole('button', { name: 'Agregar acuerdo' }).click();
  await expect(page.locator('.task-row', { hasText: 'Reservar lugar en la feria' })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar decisión' }).click();
  await page.locator('.modal input').first().fill('Participar en la feria de diciembre');
  await page.locator('.modal .prop-btn').click();
  await page.locator('.menu .menu-item', { hasText: 'Beto Integrante' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Pedir aprobación' }).click();
  await expect(page.locator('.list-row', { hasText: 'Participar en la feria' })).toContainText('Pendiente');

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, MEMBER);
  await expect(p2.locator('.card', { hasText: 'Decisiones por aprobar' })).toContainText('Participar en la feria');
  await p2.locator('.card', { hasText: 'Decisiones por aprobar' }).locator('.list-row', { hasText: 'Participar en la feria' }).click();
  await p2.getByRole('button', { name: 'Aprobar' }).click();
  await expect(p2.locator('.modal')).toContainText('Aprobada');
  await ctx.close();
});

test('11. papelera: eliminar y restaurar un proyecto', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Nuevo proyecto' }).first().click();
  await page.getByText('Proyecto en blanco').click();
  await page.locator('#pname').fill('Proyecto temporal');
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await page.getByRole('button', { name: 'Opciones del proyecto' }).click();
  await page.getByRole('menuitem', { name: 'Enviar a la papelera' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Enviar a la papelera' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator('.card', { hasText: 'Proyecto temporal' })).toHaveCount(0);
  await page.goto('/trash');
  await page.locator('.list-row', { hasText: 'Proyecto temporal' }).getByRole('button', { name: 'Restaurar' }).click();
  await page.goto('/projects');
  await expect(page.locator('.card', { hasText: 'Proyecto temporal' })).toBeVisible();
});

test('13. edición simultánea: no se pierde trabajo y se avisa del conflicto', async ({ page, browser }) => {
  await login(page, ADMIN);
  const res = await page.request.post('/api/pages', { headers: { 'X-PE-Client': '1' }, data: { title: 'Plan compartido', content: [{ type: 'paragraph', content: 'Inicio' }] } });
  const { id } = await res.json();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, MEMBER);
  await page.goto(`/docs/${id}`);
  await p2.goto(`/docs/${id}`);
  // Ana edita mientras Beto no escribe: Beto recibe el cambio sin recargar.
  await page.locator('.bn-editor p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' de Ana', { delay: 30 });
  await expect(p2.locator('.bn-editor')).toContainText('Inicio de Ana', { timeout: 8000 });
  // Ambos escriben a la vez: el segundo en guardar ve el aviso y su texto se conserva.
  await p2.locator('.bn-editor p').first().click();
  await p2.keyboard.press('End');
  const typing = p2.keyboard.type(' y de Beto', { delay: 60 });
  await page.waitForTimeout(200);
  await page.keyboard.type(' otra vez', { delay: 10 });
  await typing;
  await expect(p2.locator('.save-state')).toContainText('Conflicto', { timeout: 8000 });
  await expect(p2.locator('.bn-editor')).toContainText('y de Beto');
  await p2.getByRole('button', { name: 'Guardar mi versión como copia' }).click();
  await expect(p2.locator('.save-state')).toContainText('Guardado');
  await expect(p2.locator('.bn-editor')).toContainText('otra vez');
  const pages = await (await page.request.get('/api/pages')).json();
  expect(pages.some((pg) => pg.title === 'Plan compartido (mi versión)')).toBe(true);
  await ctx.close();
});

test.describe('móvil', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('12. en el teléfono no hay desplazamiento horizontal y se crean tareas desde el botón +', async ({ page }) => {
    await login(page, MEMBER);
    for (const url of ['/', '/tasks', '/projects/1', '/chat', '/docs', '/finance', '/calendar', '/settings/profile']) {
      await page.goto(url);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `desbordamiento horizontal en ${url}`).toBe(false);
    }
    await page.goto('/');
    await page.locator('.mobile-nav .fab').click();
    await page.getByRole('menuitem', { name: 'Tarea' }).click();
    await page.getByPlaceholder('¿Qué hay que hacer?').fill('Tarea desde el teléfono');
    await page.getByRole('button', { name: 'Crear tarea' }).click();
    await page.locator('.mobile-nav a', { hasText: 'Tareas' }).click();
    await expect(page.locator('.task-row', { hasText: 'Tarea desde el teléfono' })).toBeVisible();
  });
});
