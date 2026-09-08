// Estos valores deben coincidir con las reglas de negocio definidas en index.js (servidor).
// Aquí solo se usan para mostrarle un cálculo estimado al cajero antes de confirmar la venta.
const VALOR_MINIMO_TARIFA_ESPECIAL = 50000;
const DESCUENTO_TARIFA_ESPECIAL = 0.05;

const cajero = JSON.parse(localStorage.getItem('cajero') || 'null');
if (!cajero) {
  window.location.href = 'login.html';
}

document.getElementById('nombre-cajero').textContent = cajero ? cajero.nombre : '';
document.getElementById('btn-salir').addEventListener('click', () => {
  localStorage.removeItem('cajero');
  window.location.href = 'login.html';
});

let productos = [];
let carrito = []; // { codigo, nombre, precio, cantidad }
let clienteActual = null; // null = venta sin registrar

function formatoPesos(valor) {
  return '$' + Math.round(valor).toLocaleString('es-CO');
}

function mostrarMensaje(elId, texto, tipo) {
  const el = document.getElementById(elId);
  el.textContent = texto;
  el.className = 'mensaje ' + tipo;
}

function ocultarMensaje(elId) {
  document.getElementById(elId).className = 'mensaje oculto';
}

// ---- Cargar catálogo de productos ----

async function cargarProductos() {
  const respuesta = await fetch('/api/productos');
  productos = await respuesta.json();
  const select = document.getElementById('select-producto');
  select.innerHTML = productos
    .map((p) => `<option value="${p.codigo}">${p.nombre} - ${formatoPesos(p.precio)}</option>`)
    .join('');
}

// ---- Cliente ----

document.getElementById('btn-buscar-cliente').addEventListener('click', async () => {
  const identificacion = document.getElementById('identificacion-cliente').value.trim();
  ocultarMensaje('mensaje-cliente');
  document.getElementById('form-registro').classList.add('oculto');

  if (!identificacion) {
    mostrarMensaje('mensaje-cliente', 'Ingrese un número de identificación', 'error');
    return;
  }

  const respuesta = await fetch(`/api/clientes/${encodeURIComponent(identificacion)}`);
  if (respuesta.ok) {
    clienteActual = await respuesta.json();
    mostrarInfoCliente();
  } else {
    clienteActual = null;
    document.getElementById('cliente-info').classList.add('oculto');
    document.getElementById('form-registro').classList.remove('oculto');
  }
  actualizarTotales();
});

document.getElementById('btn-venta-sin-cliente').addEventListener('click', () => {
  clienteActual = null;
  document.getElementById('identificacion-cliente').value = '';
  document.getElementById('cliente-info').classList.add('oculto');
  document.getElementById('form-registro').classList.add('oculto');
  mostrarMensaje('mensaje-cliente', 'Venta sin cliente registrado: no acumulará ni podrá pagar con puntos', 'exito');
  actualizarTotales();
});

document.getElementById('form-registro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const identificacion = document.getElementById('identificacion-cliente').value.trim();
  const nombre = document.getElementById('reg-nombre').value.trim();
  const apellido = document.getElementById('reg-apellido').value.trim();

  const respuesta = await fetch('/api/clientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identificacion, nombre, apellido }),
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    mostrarMensaje('mensaje-cliente', datos.error, 'error');
    return;
  }

  clienteActual = datos;
  document.getElementById('form-registro').classList.add('oculto');
  document.getElementById('form-registro').reset();
  mostrarMensaje('mensaje-cliente', 'Cliente registrado correctamente', 'exito');
  mostrarInfoCliente();
  actualizarTotales();
});

function mostrarInfoCliente() {
  const el = document.getElementById('cliente-info');
  el.classList.remove('oculto');
  el.innerHTML = `<strong>${clienteActual.nombre} ${clienteActual.apellido}</strong>
    (ID: ${clienteActual.identificacion}) — Puntos disponibles: <strong>${clienteActual.puntos}</strong>`;
}

// ---- Carrito de productos ----

document.getElementById('btn-agregar-producto').addEventListener('click', () => {
  const codigo = document.getElementById('select-producto').value;
  const cantidad = Number(document.getElementById('cantidad-producto').value) || 1;
  const producto = productos.find((p) => p.codigo === codigo);
  if (!producto || cantidad < 1) return;

  const existente = carrito.find((it) => it.codigo === codigo);
  if (existente) {
    existente.cantidad += cantidad;
  } else {
    carrito.push({ codigo: producto.codigo, nombre: producto.nombre, precio: producto.precio, cantidad });
  }
  renderizarCarrito();
});

function quitarDelCarrito(codigo) {
  carrito = carrito.filter((it) => it.codigo !== codigo);
  renderizarCarrito();
}

function renderizarCarrito() {
  const tbody = document.getElementById('tabla-carrito');
  tbody.innerHTML = carrito
    .map(
      (it) => `<tr>
        <td>${it.nombre}</td>
        <td>${it.cantidad}</td>
        <td>${formatoPesos(it.precio * it.cantidad)}</td>
        <td><button class="secundario" onclick="quitarDelCarrito('${it.codigo}')">Quitar</button></td>
      </tr>`
    )
    .join('');
  actualizarTotales();
}

// ---- Totales (cálculo estimado en el cliente) ----

function calcularSubtotal() {
  return carrito.reduce((acc, it) => acc + it.precio * it.cantidad, 0);
}

function actualizarTotales() {
  const subtotal = calcularSubtotal();
  const aplicaTarifa = clienteActual !== null && subtotal >= VALOR_MINIMO_TARIFA_ESPECIAL;
  const descuento = aplicaTarifa ? subtotal * DESCUENTO_TARIFA_ESPECIAL : 0;
  const total = subtotal - descuento;

  document.getElementById('txt-subtotal').textContent = formatoPesos(subtotal);
  document.getElementById('txt-descuento').textContent = formatoPesos(descuento);
  document.getElementById('linea-descuento').style.display = aplicaTarifa ? 'flex' : 'none';
  document.getElementById('txt-total').textContent = formatoPesos(total);

  document.getElementById('puntos-disponibles').textContent = clienteActual ? clienteActual.puntos : 0;
}

// ---- Medio de pago ----

const selectMedioPago = document.getElementById('select-medio-pago');
selectMedioPago.addEventListener('change', () => {
  const esPuntos = selectMedioPago.value === 'puntos';
  document.getElementById('bloque-puntos').classList.toggle('oculto', !esPuntos);
});

document.getElementById('puntos-a-usar').addEventListener('input', () => {
  const subtotal = calcularSubtotal();
  const aplicaTarifa = clienteActual !== null && subtotal >= VALOR_MINIMO_TARIFA_ESPECIAL;
  const total = aplicaTarifa ? subtotal * (1 - DESCUENTO_TARIFA_ESPECIAL) : subtotal;
  const puntosAUsar = Number(document.getElementById('puntos-a-usar').value) || 0;
  const cubreTotal = puntosAUsar * 100 >= total;
  document.getElementById('bloque-restante').classList.toggle('oculto', cubreTotal);
});

// ---- Finalizar venta ----

document.getElementById('btn-finalizar').addEventListener('click', async () => {
  ocultarMensaje('mensaje-venta');

  if (carrito.length === 0) {
    mostrarMensaje('mensaje-venta', 'Agregue al menos un producto', 'error');
    return;
  }

  const medioPago = selectMedioPago.value;
  const puntosAUsar = Number(document.getElementById('puntos-a-usar').value) || 0;
  const metodoRestante = document.getElementById('select-metodo-restante').value;

  const cuerpo = {
    identificacionCliente: clienteActual ? clienteActual.identificacion : null,
    items: carrito.map((it) => ({ codigo: it.codigo, cantidad: it.cantidad })),
    medioPago,
    puntosAUsar: medioPago === 'puntos' ? puntosAUsar : undefined,
    metodoRestante: medioPago === 'puntos' ? metodoRestante : undefined,
  };

  const respuesta = await fetch('/api/venta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    mostrarMensaje('mensaje-venta', datos.error, 'error');
    return;
  }

  mostrarFactura(datos);
});

function mostrarFactura(factura) {
  document.getElementById('panel-factura').classList.remove('oculto');
  const filasItems = factura.items
    .map((it) => `<tr><td>${it.nombre}</td><td>${it.cantidad}</td><td>${formatoPesos(it.subtotal)}</td></tr>`)
    .join('');

  document.getElementById('contenido-factura').innerHTML = `
    <p><strong>Factura #${factura.id}</strong> — ${new Date(factura.fecha).toLocaleString('es-CO')}</p>
    <p>Cliente: ${factura.cliente ? `${factura.cliente.nombre} ${factura.cliente.apellido} (ID ${factura.cliente.identificacion})` : 'Consumidor final'}</p>
    <table>
      <thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th></tr></thead>
      <tbody>${filasItems}</tbody>
    </table>
    <div class="totales">
      <div class="linea"><span>Subtotal</span><span>${formatoPesos(factura.subtotal)}</span></div>
      ${factura.tarifaEspecialAplicada ? `<div class="linea"><span>Descuento tarifa especial <span class="badge">aplicada</span></span><span>-${formatoPesos(factura.valorDescuento)}</span></div>` : ''}
      <div class="linea total"><span>Total</span><span>${formatoPesos(factura.total)}</span></div>
      <div class="linea"><span>Medio de pago</span><span>${factura.medioPago}</span></div>
      ${factura.puntosUsados > 0 ? `<div class="linea"><span>Puntos usados</span><span>${factura.puntosUsados} (${formatoPesos(factura.valorPagadoConPuntos)})</span></div>` : ''}
      ${factura.cliente ? `<div class="linea"><span>Puntos ganados</span><span>${factura.puntosGanados}</span></div>` : ''}
      ${factura.cliente ? `<div class="linea"><span>Saldo de puntos</span><span>${factura.saldoPuntos}</span></div>` : ''}
    </div>
  `;
}

document.getElementById('btn-nueva-venta').addEventListener('click', () => {
  carrito = [];
  clienteActual = null;
  document.getElementById('identificacion-cliente').value = '';
  document.getElementById('cliente-info').classList.add('oculto');
  document.getElementById('form-registro').classList.add('oculto');
  document.getElementById('puntos-a-usar').value = 1;
  selectMedioPago.value = 'efectivo';
  document.getElementById('bloque-puntos').classList.add('oculto');
  ocultarMensaje('mensaje-cliente');
  ocultarMensaje('mensaje-venta');
  document.getElementById('panel-factura').classList.add('oculto');
  renderizarCarrito();
});

cargarProductos();
