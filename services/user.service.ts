import { Context, Service, ServiceSchema, Errors } from "moleculer";
import type { DbAdapter, DbServiceSettings, MoleculerDbMethods } from "moleculer-db";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type MongoDbAdapter from "moleculer-db-adapter-mongo";
import type { DbServiceMethods } from "../mixins/db.mixin";
import DbMixin from "../mixins/db.mixin";

const { MoleculerClientError, ValidationError } = Errors;

export interface ChannelEntity {
	_id: string;
	username: string;
	password: string;
	email: string;
	bio: string;
	image: string;
	quantity: number;
}

interface Meta {
	user?: ChannelEntity | null | undefined;
	token?: Object | null | undefined;
}

export type ActionCreateParams = Partial<ChannelEntity>;

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

const ChannelsService: ServiceSchema<ChannelSettings> & { methods: DbServiceMethods } = {
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
		 * Create a new channel.
		 * Auth is required!
		 *
		 * @actions
		 * @param {Object} channel - Channel entity
		 *
		 * @returns {Object} Created entity
		 */
		create: {
			params: {
				user: { type: "object" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				let entity = ctx.params.user;
				console.log("***********");
				console.log("***********");
				console.log("***********");
				console.log(entity);

				console.log("***********");
				console.log("***********");
				console.log("***********");
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
							.then((doc) => {
								console.log("***********");
								console.log("***********");
								console.log("***********, doc");
								console.log(doc);

								console.log("***********");
								console.log("***********");
								console.log("***********");
								return this.transformDocuments(ctx, {}, doc);
							})
							.then((user) => {
								console.log("***********");
								console.log("***********");
								console.log("***********, user");
								console.log(user);

								console.log("***********");
								console.log("***********");
								console.log("***********");
								return this.transformEntity(user, true, ctx.meta.token);
							})
							.then((json) => {
								console.log("***********");
								console.log("***********");
								console.log("***********, json");
								console.log(json);

								console.log("***********");
								console.log("***********");
								console.log("***********");
								return this.entityChanged("created", json, ctx).then(() => json);
							});
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

		/**
		 * The "moleculer-db" mixin registers the following actions:
		 *  - list
		 *  - find
		 *  - count
		 *  - create
		 *  - insert
		 *  - update
		 *  - remove
		 */

		// --- ADDITIONAL ACTIONS ---

		/**
		 * Increase the quantity of the product item.
		 */
		increaseQuantity: {
			rest: "PUT /:id/quantity/increase",
			params: {
				id: "string",
				value: "number|integer|positive",
			},
			async handler(this: ChannelThis, ctx: Context<ActionQuantityParams>): Promise<object> {
				const doc = await this.adapter.updateById(ctx.params.id, {
					$inc: { quantity: ctx.params.value },
				});
				const json = await this.transformDocuments(ctx, ctx.params, doc);
				await this.entityChanged("updated", json, ctx);

				return json;
			},
		},

		/**
		 * Decrease the quantity of the product item.
		 */
		decreaseQuantity: {
			rest: "PUT /:id/quantity/decrease",
			params: {
				id: "string",
				value: "number|integer|positive",
			},
			async handler(this: ChannelThis, ctx: Context<ActionQuantityParams>): Promise<object> {
				const doc = await this.adapter.updateById(ctx.params.id, {
					$inc: { quantity: -ctx.params.value },
				});
				const json = await this.transformDocuments(ctx, ctx.params, doc);
				await this.entityChanged("updated", json, ctx);

				return json;
			},
		},
	},

	/**
	 * Methods
	 */
	methods: {
		/**
		 * Loading sample data to the collection.
		 * It is called in the DB.mixin after the database
		 * connection establishing & the collection is empty.
		 */
		async seedDB(this: ChannelThis) {
			await this.adapter.insertMany([
				{ name: "Samsung Galaxy S10 Plus", quantity: 10, price: 704 },
				{ name: "iPhone 11 Pro", quantity: 25, price: 999 },
				{ name: "Huawei P30 Pro", quantity: 15, price: 679 },
			]);
		},

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
		 * Transform returned user entity. Generate JWT token if neccessary.
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
		 * Transform returned user entity as profile.
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

	/**
	 * Fired after database connection establishing.
	 */
	async afterConnected(this: ChannelThis) {
		if ("collection" in this.adapter) {
			if (this.settings.indexes) {
				await Promise.all(
					this.settings.indexes.map((index) =>
						(<MongoDbAdapter>this.adapter).collection.createIndex(index),
					),
				);
			}
		}
	},

	events: {
		"cache.clean.users"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.follows"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
	},
};

export default ChannelsService;
