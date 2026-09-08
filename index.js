const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

const PUNTOS_POR_PESOS = 100; // 1 punto por cada $100 de compra
const VALOR_MINIMO_TARIFA_ESPECIAL = 50000; // umbral de la tarifa especial
const DESCUENTO_TARIFA_ESPECIAL = 0.05; // 5% de descuento al superar el umbral
const VALOR_PUNTO_EN_PESOS = 100; // 1 punto equivale a $100 al usarlo como pago

function readJSON(nombreArchivo) {
  const ruta = path.join(DATA_DIR, nombreArchivo);
  return JSON.parse(fs.readFileSync(ruta, 'utf-8'));
}

function writeJSON(nombreArchivo, data) {
  const ruta = path.join(DATA_DIR, nombreArchivo);
  fs.writeFileSync(ruta, JSON.stringify(data, null, 2));
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  const rutaRelativa = pathname === '/' ? '/login.html' : pathname;
  const rutaArchivo = path.join(PUBLIC_DIR, path.normalize(rutaRelativa));

  if (!rutaArchivo.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }

  fs.readFile(rutaArchivo, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    const ext = path.extname(rutaArchivo);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(contenido);
  });
}

// ---- Handlers de la API ----

function handleLogin(req, res) {
  readBody(req).then(({ usuario, password }) => {
    const usuarios = readJSON('usuarios.json');
    const encontrado = usuarios.find((u) => u.usuario === usuario && u.password === password);
    if (!encontrado) {
      return sendJSON(res, 401, { error: 'Usuario o contraseña incorrectos' });
    }
    sendJSON(res, 200, { nombre: encontrado.nombre, usuario: encontrado.usuario, rol: encontrado.rol });
  });
}

function handleGetProductos(req, res) {
  sendJSON(res, 200, readJSON('productos.json'));
}

function handleGetClientes(req, res) {
  sendJSON(res, 200, readJSON('clientes.json'));
}

function handleBuscarCliente(req, res, identificacion) {
  const clientes = readJSON('clientes.json');
  const cliente = clientes.find((c) => c.identificacion === identificacion);
  if (!cliente) {
    return sendJSON(res, 404, { error: 'Cliente no registrado' });
  }
  sendJSON(res, 200, cliente);
}

function handleRegistrarCliente(req, res) {
  readBody(req).then(({ identificacion, nombre, apellido }) => {
    if (!identificacion || !nombre || !apellido) {
      return sendJSON(res, 400, { error: 'Faltan datos del cliente' });
    }
    const clientes = readJSON('clientes.json');
    if (clientes.some((c) => c.identificacion === identificacion)) {
      return sendJSON(res, 409, { error: 'Ese cliente ya está registrado' });
    }
    const nuevoCliente = { identificacion, nombre, apellido, puntos: 0 };
    clientes.push(nuevoCliente);
    writeJSON('clientes.json', clientes);
    sendJSON(res, 201, nuevoCliente);
  });
}

// RF-04/05/06/07/08/09/10/11/12/13: registra la venta, calcula descuento, puntos y factura.
function handleVenta(req, res) {
  readBody(req).then((venta) => {
    const { identificacionCliente, items, medioPago, puntosAUsar, metodoRestante } = venta;

    if (!Array.isArray(items) || items.length === 0) {
      return sendJSON(res, 400, { error: 'El carrito está vacío' });
    }

    const productos = readJSON('productos.json');
    const clientes = readJSON('clientes.json');

    let cliente = null;
    if (identificacionCliente) {
      cliente = clientes.find((c) => c.identificacion === identificacionCliente);
      if (!cliente) {
        return sendJSON(res, 404, { error: 'Cliente no registrado' });
      }
    }

    // RF-05: calcular el total a partir de los productos escaneados/ingresados
    const detalleItems = items.map(({ codigo, cantidad }) => {
      const producto = productos.find((p) => p.codigo === codigo);
      if (!producto) throw new Error(`Producto no encontrado: ${codigo}`);
      const subtotal = producto.precio * cantidad;
      return { codigo, nombre: producto.nombre, precio: producto.precio, cantidad, subtotal };
    });
    const subtotal = detalleItems.reduce((acc, it) => acc + it.subtotal, 0);

    // RF-10/RF-11: tarifa especial automática si el total alcanza el umbral
    const aplicaTarifaEspecial = cliente !== null && subtotal >= VALOR_MINIMO_TARIFA_ESPECIAL;
    const valorDescuento = aplicaTarifaEspecial ? Math.round(subtotal * DESCUENTO_TARIFA_ESPECIAL) : 0;
    const total = subtotal - valorDescuento;

    // RF-07/RF-08: pago con puntos, parcial o total, validando saldo suficiente
    let valorPagadoConPuntos = 0;
    let puntosUsados = 0;
    if (medioPago === 'puntos') {
      if (!cliente) {
        return sendJSON(res, 400, { error: 'Solo un cliente registrado puede pagar con puntos' });
      }
      puntosUsados = Number(puntosAUsar) || 0;
      if (puntosUsados <= 0 || puntosUsados > cliente.puntos) {
        return sendJSON(res, 400, { error: 'El cliente no tiene puntos suficientes' });
      }
      valorPagadoConPuntos = Math.min(puntosUsados * VALOR_PUNTO_EN_PESOS, total);
    }

    const restantePorPagar = total - valorPagadoConPuntos;
    if (restantePorPagar > 0 && medioPago === 'puntos' && !metodoRestante) {
      return sendJSON(res, 400, { error: 'Falta indicar cómo se paga el valor restante (efectivo o tarjeta)' });
    }

    // RF-06/RF-09: puntos ganados solo sobre el valor pagado en efectivo/tarjeta, y actualización del saldo
    let puntosGanados = 0;
    if (cliente) {
      puntosGanados = Math.floor(restantePorPagar / PUNTOS_POR_PESOS);
      cliente.puntos = cliente.puntos - puntosUsados + puntosGanados;
      writeJSON('clientes.json', clientes);
    }

    // RF-13: generar la factura con el detalle completo
    const facturas = readJSON('facturas.json');
    const factura = {
      id: facturas.length + 1,
      fecha: new Date().toISOString(),
      cliente: cliente ? { identificacion: cliente.identificacion, nombre: cliente.nombre, apellido: cliente.apellido } : null,
      items: detalleItems,
      subtotal,
      tarifaEspecialAplicada: aplicaTarifaEspecial,
      valorDescuento,
      total,
      medioPago: medioPago === 'puntos' && restantePorPagar > 0 ? `puntos + ${metodoRestante}` : medioPago,
      puntosUsados,
      valorPagadoConPuntos,
      valorPagadoOtroMedio: restantePorPagar,
      puntosGanados,
      saldoPuntos: cliente ? cliente.puntos : null,
    };
    facturas.push(factura);
    writeJSON('facturas.json', facturas);

    sendJSON(res, 201, factura);
  }).catch((err) => sendJSON(res, 400, { error: err.message }));
}

// ---- Enrutamiento ----

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/productos' && req.method === 'GET') return handleGetProductos(req, res);
  if (pathname === '/api/clientes' && req.method === 'GET') return handleGetClientes(req, res);
  if (pathname === '/api/clientes' && req.method === 'POST') return handleRegistrarCliente(req, res);
  if (pathname.startsWith('/api/clientes/') && req.method === 'GET') {
    return handleBuscarCliente(req, res, decodeURIComponent(pathname.split('/')[3]));
  }
  if (pathname === '/api/venta' && req.method === 'POST') return handleVenta(req, res);

  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Servidor del POS Tienda UPB corriendo en http://localhost:${PORT}`);
});
