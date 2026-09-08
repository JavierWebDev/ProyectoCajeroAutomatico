document.getElementById('form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const usuario = document.getElementById('usuario').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('error');
  errorEl.classList.add('oculto');

  const respuesta = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    errorEl.textContent = datos.error || 'No fue posible iniciar sesión';
    errorEl.classList.remove('oculto');
    return;
  }

  localStorage.setItem('cajero', JSON.stringify(datos));
  window.location.href = 'pos.html';
});
