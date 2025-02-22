document.addEventListener("DOMContentLoaded", function () {
    const API_KEY = "AIzaSyCNzSAnvKQBnA0-ITMdQ1wtkHaZrRmBOcM";
    const SHEET_ID = "1BsW-YT0x8MrpZeB-WgVxqjMfU4mTacla-IFRLhEDnWU";
    let SHEET_NAME = "Administrativo"; // Hoja por defecto
    const URL_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/`;

    const calendarioDiv = document.getElementById("calendario");
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const diasPorMes = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const diasSemana = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const HOJAS = ["Administrativo", "SG SST", "Atención al cliente y ventas", "Cumpleaños", "Académico", "Eventos", "Marketing y Publicidad", "Financiero"];

    let eventos = [];
    let festivos = [];

    function cargarEventos() {
        const URL = `${URL_BASE}${SHEET_NAME}?key=${API_KEY}`;
        eventos = [];

        fetch(URL)
            .then(response => response.json())
            .then(data => {
                if (data.values) {
                    let filas = data.values.slice(1);
                    filas.forEach(fila => {
                        let [fecha, descripcion] = fila;
                        let [dia, mes, año] = fecha.split("/").map(n => parseInt(n));

                        // 🔹 Agregar una propiedad con el nombre de la hoja
                        eventos.push({ dia, mes, descripcion, hoja: SHEET_NAME });
                    });
                    generarCalendario();
                }
            })
            .catch(error => console.error("Error al obtener los datos:", error));
    }

    function cargarFestivos() {
        const URL_FESTIVOS = `${URL_BASE}Festivos?key=${API_KEY}`;

        fetch(URL_FESTIVOS)
            .then(response => response.json())
            .then(data => {
                if (data.values) {
                    festivos = data.values.slice(1).map(fila => {
                        let [fecha, nombre] = fila;
                        let [dia, mes, año] = fecha.split("/").map(n => parseInt(n));
                        return { dia, mes, nombre };
                    });
                }
                cargarEventos();
            })
            .catch(error => console.error("Error al obtener los festivos:", error));
    }

    function generarCalendario() {
        calendarioDiv.innerHTML = "";

        let hoy = new Date();
        let diaHoy = hoy.getDate();
        let mesHoy = hoy.getMonth() + 1; // Enero es 0, por eso sumamos 1

        for (let i = 0; i < 12; i++) {
            let mesDiv = document.createElement("div");
            mesDiv.classList.add("mes");

            let titulo = document.createElement("h3");
            titulo.textContent = meses[i];
            mesDiv.appendChild(titulo);

            let diasContainer = document.createElement("div");
            diasContainer.classList.add("dias-container");

            // Agregar nombres de días de la semana
            for (let dia of diasSemana) {
                let diaSemanaDiv = document.createElement("div");
                diaSemanaDiv.classList.add("dia-semana");
                diaSemanaDiv.textContent = dia;
                diasContainer.appendChild(diaSemanaDiv);
            }

            // Calcular el día de la semana del primer día del mes
            let fechaInicio = new Date(2025, i, 1);
            let primerDiaSemana = fechaInicio.getDay();

            // Espacios vacíos antes del primer día
            for (let j = 0; j < primerDiaSemana; j++) {
                let espacioVacio = document.createElement("div");
                espacioVacio.classList.add("dia", "vacio");
                diasContainer.appendChild(espacioVacio);
            }

            // Agregar días del mes
            for (let d = 1; d <= diasPorMes[i]; d++) {
                let diaDiv = document.createElement("div");
                diaDiv.classList.add("dia");

                let numeroDia = document.createElement("span");
                numeroDia.textContent = d;
                diaDiv.appendChild(numeroDia);

                // 🔹 Marcar el día actual
                if (d === diaHoy && i + 1 === mesHoy) {
                    diaDiv.classList.add("hoy");
                }

                // Verificar si es festivo
                let festivo = festivos.find(f => f.dia === d && f.mes === i + 1);
                if (festivo) {
                    diaDiv.classList.add("festivo");
                    let festivoSpan = document.createElement("div");
                    festivoSpan.classList.add("evento", "evento-festivos");
                    festivoSpan.textContent = festivo.nombre;
                    diaDiv.appendChild(festivoSpan);
                }

                // Verificar si hay eventos
                let eventosDia = eventos.filter(e => e.dia === d && e.mes === i + 1);
                if (eventosDia.length > 0) {
                    eventosDia.forEach(evento => {
                        let eventoSpan = document.createElement("div");
                        eventoSpan.classList.add("evento");

                        // 🔹 Asignamos una clase basada en la hoja
                        let claseHoja = evento.hoja.toLowerCase().replace(/\s+/g, "-");
                        eventoSpan.classList.add(`evento-${claseHoja}`);

                        eventoSpan.textContent = evento.descripcion;
                        diaDiv.appendChild(eventoSpan);
                    });
                }

                diasContainer.appendChild(diaDiv);
            }

            mesDiv.appendChild(diasContainer);
            calendarioDiv.appendChild(mesDiv);
        }
    }

    // Agregar evento a los botones
    document.querySelectorAll(".btn-hoja").forEach(boton => {
        boton.addEventListener("click", function () {
            SHEET_NAME = this.dataset.hoja;
            cargarEventos();
        });
    });

    document.getElementById("btn-cronograma").addEventListener("click", cargarCronograma);

    function cargarCronograma() {
        eventos = []; // Reiniciamos eventos

        let promesas = HOJAS.map(hoja => {
            let url = `${URL_BASE}${hoja}?key=${API_KEY}`;
            return fetch(url)
                .then(response => response.json())
                .then(data => {
                    if (data.values) {
                        let filas = data.values.slice(1);
                        filas.forEach(fila => {
                            let [fecha, descripcion] = fila;
                            let [dia, mes, año] = fecha.split("/").map(n => parseInt(n));
                            eventos.push({ dia, mes, descripcion, hoja });
                        });
                    }
                })
                .catch(error => console.error(`Error en hoja ${hoja}:`, error));
        });

        promesas.push(fetch(`${URL_BASE}Festivos?key=${API_KEY}`)
            .then(response => response.json())
            .then(data => {
                if (data.values) {
                    festivos = data.values.slice(1).map(fila => {
                        let [fecha, nombre] = fila;
                        let [dia, mes, año] = fecha.split("/").map(n => parseInt(n));
                        return { dia, mes, nombre };
                    });
                }
            })
            .catch(error => console.error("Error al obtener festivos:", error))
        );

        Promise.all(promesas).then(() => generarCalendario());
    }

    cargarFestivos();
});
