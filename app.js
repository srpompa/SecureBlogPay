require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const methodOverride = require('method-override');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const flash = require('connect-flash');
const paypal = require('@paypal/checkout-server-sdk');

const User = require('./models/User');
const Blog = require('./models/Blog');
const Producto = require('./models/Producto');
const Activity = require('./models/Activity');

const app = express();
const port = process.env.PORT;

// Configuración de la sesión
app.use(session({
    secret: process.env.SECRET_SESSION || 'mi-secreto',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Inicializa Passport y maneja las sesiones
app.use(passport.initialize());
app.use(passport.session());

// Configurar estrategia de autenticación local
passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
}, async (email, password, done) => {
    try {
        const user = await User.findOne({ email });
        if (!user) return done(null, false, { message: 'Usuario no encontrado' });
        const isMatch = await user.comparePassword(password);
        if (!isMatch) return done(null, false, { message: 'Contraseña incorrecta' });
        return done(null, user);
    } catch (error) {
        return done(error);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Configuración de PayPal
function createPayPalClient() {
    let environment = new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
    );
    return new paypal.core.PayPalHttpClient(environment);
}

const PaypalClient = createPayPalClient();

// Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Conexión con MongoDB establecida con éxito"))
    .catch(error => console.log("Error al conectar con MongoDB"));

// Configuración de la aplicación
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'vistas'));
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(flash());


// Configuración de multer para subir archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Los archivos se guardarán en la carpeta 'uploads'
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Nombre único para el archivo
    }
});

const upload = multer({ storage: storage });

app.post('/crear', upload.single('image'), async (req, res) => {
    const { nombre, apellido, edad, nacionalidad, sexo, email, password, birthdate } = req.body;

    const user = new User({
        nombre,
        apellido,
        edad,
        nacionalidad,
        sexo,
        email,
        password,
        birthdate: new Date(birthdate),
        imagePath: req.file ? `/uploads/${req.file.filename}` : null // Guardar la ruta de la imagen
    });

    try {
        await user.save();
        res.redirect('/');
    } catch (error) {
        console.log('Error al guardar el usuario:', error);
        res.status(500).send("Error al guardar el usuario");
    }
});

//

app.use((req, res, next) => {
    res.locals.messages = req.flash();
    next();
});

// Middleware para mantener la sesión durante 20 minutos de inactividad
app.use((req, res, next) => {
    if (req.session) {
        req.session.cookie.maxAge = 20 * 60 * 1000; // 20 minutos
    }
    next();
});

// Rutas
app.get('/', (req, res) => {
    Blog.find().sort({ createdAt: -1 })
        .then((blogs) => {
            res.render('main', { title: 'Inicio', blogs, user: req.user });
        })
        .catch((error) => {
            console.log(error);
            res.status(500).send("Error al cargar los blogs");
        });
});

// Rutas de autenticación
app.get('/login', (req, res) => {
    res.render('login', { title: 'Iniciar Sesión', message: req.flash('error'), user: req.user });
});

app.post('/login', passport.authenticate('local', {
    successRedirect: '/todos-los-usuarios',
    failureRedirect: '/login',
    failureFlash: true
}));

app.get('/logout', (req, res) => {
    req.logout((error) => {
        if (error) {
            console.log(error);
            res.status(500).send('Error al cerrar sesión');
            return;
        }
        res.redirect('/');
    });
});

app.get('/sign-up', (req, res) => {
    res.render('sign-up', { title: 'Registrarse', user: req.user });
});

app.post('/sign-up', upload.single('image'), async (req, res) => {
    const { nombre, apellido, email, password, edad, nacionalidad, sexo, birthdate } = req.body;

    try {
        // Verificar si el correo electrónico ya está registrado
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            req.flash('error', 'El correo electrónico ya está registrado.');
            return res.redirect('/sign-up');
        }

        // Crear un nuevo usuario
        const user = new User({
            nombre,
            apellido,
            email: email.toLowerCase(),
            password,
            edad: edad ? parseInt(edad, 10) : null, 
            nacionalidad,
            sexo,
            birthdate: birthdate ? new Date(birthdate) : null,
            imagePath: req.file ? `/uploads/${req.file.filename}` : null
        });

        // Guardar el nuevo usuario en la base de datos
        await user.save();

        // Redirigir al usuario a la página de inicio de sesión
        req.flash('success', 'Registro exitoso. Por favor, inicia sesión.');
        res.redirect('/login');
    } catch (error) {
        console.error('Error al registrar el usuario:', error);
        req.flash('error', 'Error al registrar el usuario. Inténtalo de nuevo.');
        res.redirect('/sign-up');
    }
});

// Rutas de usuarios
app.get('/todos-los-usuarios', ensureAuthenticated, (req, res) => {
    User.find()
        .then((users) => {
            res.render('todos-los-usuarios', { title: 'Todos los Usuarios', users, user: req.user });
        })
        .catch((error) => {
            console.log(error);
            res.status(500).send("Error al cargar los usuarios");
        });
});

// Ruta para mostrar todos los productos
app.get('/productos', async (req, res) => {
    try {
        const productos = await Producto.find().sort({ createdAt: -1 });
        const cesta = req.session.cesta || [];
        const cestaCantidad = cesta.reduce((total, item) => total + item.cantidad, 0);
        res.render('productosclase', { title: 'Lista de Productos', productos, cestaCantidad, user: req.user });
    } catch (error) {
        console.log('Error al obtener los productos:', error);
        res.status(500).send("Error al cargar los productos");
    }
});

// Ruta para agregar un producto a la cesta
app.post('/agregar-a-cesta', async (req, res) => {
    const { productoId, cantidad } = req.body;
    const cantidadInt = parseInt(cantidad, 10);
    const producto = await Producto.findById(productoId);

    if (!producto) return res.status(404).send("Producto no encontrado");

    req.session.cesta = req.session.cesta || [];
    const productoExistente = req.session.cesta.find(item => item.productoId == productoId);

    if (productoExistente) {
        productoExistente.cantidad += cantidadInt;
    } else {
        req.session.cesta.push({
            productoId,
            nombre: producto.nombre,
            precio: producto.precio,
            imagenUrl: producto.imagenUrl,
            cantidad: cantidadInt
        });
    }

    req.session.save(err => {
        if (err) return res.status(500).send("Error al guardar la cesta");
        res.redirect('/productos');
    });
});

// Ruta para mostrar la cesta
app.get('/cesta', (req, res) => {
    res.render('cesta', { 
        title: 'Cesta', 
        cesta: req.session.cesta || [], 
        user: req.user || null 
    });
});


// Ruta para procesar el pago con PayPal
app.post('/pagar', async (req, res) => {
    try {
        if (!req.session.cesta || req.session.cesta.length === 0) {
            return res.status(400).json({ message: "La cesta está vacía" });
        }

        const total = req.session.cesta.reduce((sum, item) => sum + item.precio * item.cantidad, 0).toFixed(2);

        const request = new paypal.orders.OrdersCreateRequest();
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'EUR',
                    value: total
                },
                description: 'Compra en Mi Tienda'
            }]
        });

        const order = await PaypalClient.execute(request);
        res.json({ id: order.result.id });
    } catch (error) {
        console.error('Error al crear la orden de PayPal:', error);
        res.status(500).json({ message: "Error al procesar el pago" });
    }
});

// Ruta para capturar el pago
app.post('/capturar-pago/:orderID', async (req, res) => {
    try {
        const orderID = req.params.orderID;
        const request = new paypal.orders.OrdersCaptureRequest(orderID);
        const capture = await PaypalClient.execute(request);

        // Aquí puedes guardar los detalles del pago en tu base de datos si lo deseas

        res.json({ captureID: capture.result.id });
    } catch (error) {
        console.error('Error al capturar el pago:', error);
        res.status(500).json({ message: "Error al capturar el pago" });
    }
});

// Ruta para limpiar la cesta después de un pago exitoso
app.post('/limpiar-cesta', (req, res) => {
    req.session.cesta = [];
    req.session.save(err => {
        if (err) {
            return res.status(500).json({ message: "Error al limpiar la cesta" });
        }
        res.json({ message: "Cesta limpiada con éxito" });
    });
});


// Ruta para mostrar el formulario de creación de blogs
app.get('/blogs/crear', ensureAuthenticated, (req, res) => {
    res.render('crear-blog', { title: 'Crear Blog', user: req.user });
});

// Ruta para crear un nuevo blog
app.post('/blogs', ensureAuthenticated, upload.single('image'), (req, res) => {
    const { title, snippet, body, fecha } = req.body;

    const newBlog = new Blog({
        title,
        snippet,
        body,
        fecha: new Date(fecha), // Convertir la fecha a un objeto Date
        imagePath: req.file ? `/uploads/${req.file.filename}` : null
    });

    newBlog.save()
        .then(() => {
            res.redirect('/');
        })
        .catch((error) => {
            console.log(error);
            res.status(500).send("Error al guardar el blog");
        });
});

// Ruta para ver un blog específico
app.get('/blogs/:id', (req, res) => {
    const blogId = req.params.id;
    Blog.findById(blogId)
        .then((blog) => {
            if (!blog) {
                return res.status(404).render('404', { title: 'Error 404', user: req.user });
            }
            res.render('ver-blog', { title: blog.title, blog, user: req.user });
        })
        .catch((error) => {
            console.log(error);
            res.status(500).send("Error al cargar el blog");
        });
});


app.get('/blogs/editar/:id', ensureAuthenticated, (req, res) => {
    const blogId = req.params.id;

    Blog.findById(blogId)
        .then((blog) => {
            res.render('editar-blog', { title: 'Editar Blog', blog, user: req.user });
        })
        .catch((error) => {
            console.log(error);
            res.status(404).render('404', { title: 'Error 404', user: req.user });
        });
});

// Ruta para editar un blog
app.post('/blogs/editar/:id', ensureAuthenticated, upload.single('image'), (req, res) => {
    const blogId = req.params.id;
    const { title, snippet, body, fecha } = req.body;

    // Construir los datos a actualizar
    const updateData = {
        title,
        snippet,
        body,
        fecha: new Date(fecha)
    };

    // Si se subió una nueva imagen, incluye la ruta en los datos
    if (req.file) {
        updateData.imagePath = `/uploads/${req.file.filename}`;
    }

    // Actualiza el blog en la base de datos
    Blog.findByIdAndUpdate(blogId, updateData, { new: true })
        .then(() => {
            res.redirect(`/blogs/${blogId}`);
        })
        .catch((error) => {
            console.error('Error al actualizar el blog:', error);
            res.status(500).send('Error al actualizar el blog');
        });
});

// Ruta para actualizar un blog
app.put('/blogs/:id', ensureAuthenticated, (req, res) => {
    const blogId = req.params.id;
    const { title, snippet, body } = req.body;

    Blog.findByIdAndUpdate(blogId, { title, snippet, body }, { new: true })
        .then(() => {
            res.redirect(`/blogs/${blogId}`);
        })
        .catch((error) => {
            console.log(error);
            res.status(500).send("Error al actualizar el blog");
        });
});

// Ruta para eliminar un blog
app.delete('/blogs/:id', ensureAuthenticated, (req, res) => {
    const blogId = req.params.id;
    Blog.findByIdAndDelete(blogId)
        .then(() => {
            res.redirect('/');
        })
        .catch((error) => {
            console.log(error);
            res.status(500).send("Error al eliminar el blog");
        });
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).render('errorAuth', {
        title: 'Error de autenticación',
        message: 'Debes iniciar sesión para acceder a esta página',
        user: req.user // Asegúrate de pasar el usuario si es necesario
    });
}

// 404
app.use((req, res) => {
    res.status(404).render('404', { title: 'Error 404', user: req.user });
});