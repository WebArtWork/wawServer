const User = require(__dirname+'/schema.js');
const mongoose = require('mongoose');
const passport = require('passport');
module.exports = async function(waw) {
	// initialize
		if(waw.config.mail){
			const nodemailer = require("nodemailer");
			let transporter = nodemailer.createTransport({
				host: waw.config.mail.host,
				port: waw.config.mail.port,
				secure: waw.config.mail.secure,
				auth: waw.config.mail.auth
			});
			waw.send = (opts, cb=resp=>{})=>{
				transporter.sendMail({
					from: waw.config.mail.from,
					subject: opts.subject || waw.config.mail.subject,
					to: opts.to,
					text: opts.text,
					html: opts.html
				}, cb);
			}
		}else{
			waw.send = ()=>{}
		}
		waw.use(passport.initialize());
		waw.use(passport.session());
		if(mongoose.connection.readyState==0){
			mongoose.connect(waw.mongoUrl, {
				useUnifiedTopology: true,
				useNewUrlParser: true
			});
			mongoose.Promise = global.Promise;
		}
		passport.serializeUser(function(user, done) {
			done(null, user.id);
		});
		passport.deserializeUser(function(id, done) {
			User.findById(id, function(err, user) {
				done(err, user);
			});
		});
	/*
	*	Set is on users from config
	*/
		const set_is = (email, is)=>{
			User.findOne({
				email: email
			}, function(err, user){
				if(!user) return;
				if(!user.is) user.is={};
				user.is[is] = true;
				user.markModified('is');
				user.save((err)=>{
					if(err) console.log(err);
				});
			});
		}
		if(waw.config.user && waw.config.user.is){
			for(let is in waw.config.user.is){
				let emails = waw.config.user.is[is].split(' ');
				for (var i = 0; i < emails.length; i++) {
					set_is(emails[i], is);
				}
			}
		}
	/*
	*	Initialize User and Mongoose
	*/
		const prepare_user = function(user){
			user = JSON.parse(JSON.stringify(user));
			delete user.fb_token;
			delete user.google_token;
			delete user.password;
			delete user.resetPin;
			delete user.resetCounter;
			delete user.resetCreate;
			return user;
		}
		const router = waw.router('/api/user');
		router.post("/status", function(req, res) {
			User.findOne({
				$or: [{
					reg_email: req.body.email.toLowerCase()
				},{
					email: req.body.email.toLowerCase()
				}]
			}, function(err, user) {
				var json = {};
				json.email = !!user;
				if(user&&req.body.password){
					json.pass = user.validPassword(req.body.password);
				}
				res.json(json);
			});
		});
		router.post("/request", function(req, res) {
			User.findOne({
				email: req.body.email.toLowerCase()
			}, function(err, user) {
				user.resetPin = Math.floor(Math.random() * (999999 - 100000)) + 100000;
				console.log(user.resetPin);
				user.resetCreate = new Date().getTime();
				user.resetCounter = 3;
				user.markModified('data');
					user.save(function(err){
						if (err) throw err;
						waw.send({
							to: user.email,
							subject: 'Code: '+user.resetPin,
							html: 'Code: '+user.resetPin
						}, function(){
							res.json(true);
						});
					});
				});
		});
		router.post("/change", function(req, res) {
			User.findOne({
				email: req.body.email.toLowerCase()
			}, function(err, user) {
				var message;
				var now = new Date().getTime();
				if (user.resetCounter > 0 && (now - user.resetCreate) <= 600000) {
					if (user.resetPin == req.body.pin) {
						user.password = user.generateHash(req.body.password);
						message = 'Password successfully changed.';
						delete user.resetPin;
						delete user.resetCounter;
						delete user.resetCreate;
					} else {
						user.resetCounter--;
						message = 'Wrong code.';
					}
				} else {
					message = 'I am sorry reset code is not active now.'
					delete user.resetPin;
					delete user.resetCounter;
					delete user.resetCreate;
				}
				user.markModified('data');
				user.save(function(err) {
					if (err) throw err;
					res.json(message);
				});
			});
		});
		router.post("/changePassword", waw._ensure, function(req, res) {
			if (req.user.validPassword(req.body.oldPass)){
				req.user.password = req.user.generateHash(req.body.newPass);
				req.user.save(function(){
					res.json(true);
				});
			}else res.json(false);
		});
		router.get('/logout', function(req, res) {
			req.logout();
			res.json(true);
		});
	/*
	*	Passport Management
	*/
		var LocalStrategy = require('passport-local').Strategy;
		router.post('/login', passport.authenticate('login'), function(req, res) {
			res.json(prepare_user(req.user));
		});
		passport.use('login', new LocalStrategy({
			usernameField : 'email',
			passwordField : 'password'
		}, function(username, password, done) {
			User.findOne({
				email: username.toLowerCase(),
				blocked: {
					$ne: true
				}
			}, function(err, user) {
				if (err) return done(err);
				if (!user) return done(null, false);
				if (!user.validPassword(password)) return done(null, false);
				return done(null, user);
			});
		}));
		router.post('/signup', passport.authenticate('signup'), function(req, res) {
			res.json(prepare_user(req.user));
		});
		passport.use('signup', new LocalStrategy({
			usernameField : 'email',
			passwordField : 'password',
			passReqToCallback : true
		}, function(req, username, password, done) {
			User.findOne({
				email: username.toLowerCase()
			}, function(err, user) {
				if (err) return done(err);
				if (user) return done(null, false);
				else {
					var newUser = new User();
					newUser.is = {
						admin: false
					};
					newUser.name = req.body.name;
					newUser.email = username.toLowerCase();
					newUser.reg_email = username.toLowerCase();
					newUser.password = newUser.generateHash(password);
					newUser.data = req.session.data && typeof req.session.data == 'object' && req.session.data || {};
					newUser.save(function(err) {
						if (err) throw err;
						return done(null, newUser);
					});
				}
			});
		}));
	// End of Crud
};
