import { Context, Service, ServiceSchema, Errors } from "moleculer";
import type { DbAdapter, DbServiceSettings, MoleculerDbMethods } from "moleculer-db";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type MongoDbAdapter from "moleculer-db-adapter-mongo";
import type { DbServiceMethods } from "../mixins/db.mixin";
import DbMixin from "../mixins/db.mixin";

const { MoleculerClientError, ValidationError } = Errors;

export interface UserEntity {
	_id: string;
	username: string;
	password: string;
	email: string;
	bio: string;
	image: string;
	quantity: number;
}

interface Meta {
	user?: UserEntity | null | undefined;
	token?: Object | null | undefined;
}

export type ActionCreateParams = Partial<UserEntity>;

export interface ActionQuantityParams {
	id: string;
	value: number;
	user: any;
}

interface ChannelSettings extends DbServiceSettings {
	indexes?: Record<string, number>[];
	JWT_SECRET: any;
}

interface ChannelThis extends Service<ChannelSettings>, MoleculerDbMethods {
	adapter: DbAdapter | MongoDbAdapter;
}

const UserService: ServiceSchema<ChannelSettings> & { methods: DbServiceMethods } = {
	name: "users",
	// version: 1

	/**
	 * Mixins
	 */
	mixins: [DbMixin("users")],

	/**
	 * Settings
	 */
	settings: {
		JWT_SECRET: process.env.JWT_SECRET || "jwt-conduit-secret",

		// Available fields in the responses
		fields: ["_id", "username", "email", "bio", "image"],

		// Validator for the `create` & `insert` actions.
		entityValidator: {
			username: { type: "string", min: 2, pattern: /^[a-zA-Z0-9]+$/ },
			password: { type: "string", min: 6 },
			email: { type: "email" },
			bio: { type: "string", optional: true },
			image: { type: "string", optional: true },
		},

		// indexes: [{ name: 1 }],
	},

	/**
	 * Action Hooks
	 */
	hooks: {
		before: {
			/**
			 * Register a before hook for the `create` action.
			 * It sets a default value for the quantity field.
			 */
			create(ctx: Context<ActionCreateParams>) {
				ctx.params.quantity = 0;
			},
		},
	},

	/**
	 * Actions
	 */
	actions: {
		/**
		 * Create a new user.
		 * Auth is required!
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity
		 */
		create: {
			params: {
				user: { type: "object" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				let entity = ctx.params.user;
				return this.validateEntity(entity)
					.then(() => {
						if (entity.username)
							return this.adapter
								.findOne({ username: entity.username })
								.then((found) => {
									if (found)
										return Promise.reject(
											new MoleculerClientError(
												"Username is exist!",
												422,
												"",
												[{ field: "username", message: "is exist" }],
											),
										);
								});
					})
					.then(() => {
						if (entity.email)
							return this.adapter.findOne({ email: entity.email }).then((found) => {
								if (found)
									return Promise.reject(
										new MoleculerClientError("Email is exist!", 422, "", [
											{ field: "email", message: "is exist" },
										]),
									);
							});
					})
					.then(() => {
						entity.password = bcrypt.hashSync(entity.password, 10);
						entity.bio = entity.bio || "";
						entity.image = entity.image || null;
						entity.createdAt = new Date();

						return this.adapter
							.insert(entity)
							.then((doc) => this.transformDocuments(ctx, {}, doc))
							.then((user) => this.transformEntity(user, true, ctx.meta.token))
							.then((json) =>
								this.entityChanged("created", json, ctx).then(() => json),
							);
					});
			},
		},

		/**
		 * Get user by JWT token (for API GW authentication)
		 *
		 * @actions
		 * @param {String} token - JWT token
		 *
		 * @returns {Object} Resolved user
		 */
		resolveToken: {
			cache: {
				keys: ["token"],
				ttl: 60 * 60, // 1 hour
			},
			params: {
				token: "string",
			},
			handler(ctx) {
				return new this.Promise((resolve, reject) => {
					jwt.verify(
						ctx.params.token,
						this.settings.JWT_SECRET,
						(err: any, decoded: any) => {
							if (err) return reject(err);

							resolve(decoded);
						},
					);
				}).then((decoded: any) => {
					if (decoded.id) return this.getById(decoded.id);
				});
			},
		},
	},

	/**
	 * Methods
	 */
	methods: {
		/**
		 * Generate a JWT token from user entity
		 *
		 * @param {Object} user
		 */
		generateJWT(user) {
			const today = new Date();
			const exp = new Date(today);
			exp.setDate(today.getDate() + 60);

			return jwt.sign(
				{
					id: user._id,
					username: user.username,
					exp: Math.floor(exp.getTime() / 1000),
				},
				this.settings.JWT_SECRET,
			);
		},

		/**
		 *
		 * @param {Object} user
		 * @param {Boolean} withToken
		 */
		transformEntity(user, withToken, token) {
			if (user) {
				//user.image = user.image || "https://www.gravatar.com/avatar/" + crypto.createHash("md5").update(user.email).digest("hex") + "?d=robohash";
				user.image = user.image || "";
				if (withToken) user.token = token || this.generateJWT(user);
			}

			return { user };
		},

		/**
		 *
		 * @param {Context} ctx
		 * @param {Object} user
		 * @param {Object?} loggedInUser
		 */
		transformProfile(ctx, user, loggedInUser) {
			//user.image = user.image || "https://www.gravatar.com/avatar/" + crypto.createHash("md5").update(user.email).digest("hex") + "?d=robohash";
			user.image = user.image || "https://static.productionready.io/images/smiley-cyrus.jpg";

			if (loggedInUser) {
				return ctx
					.call("follows.has", {
						user: loggedInUser._id.toString(),
						follow: user._id.toString(),
					})
					.then((res: any) => {
						user.following = res;
						return { profile: user };
					});
			}

			user.following = false;

			return { profile: user };
		},
	},

	events: {
		"cache.clean.channels"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.users"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.topics"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.follows"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
	},
};

export default UserService;
