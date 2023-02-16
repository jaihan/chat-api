import { Context, Service, ServiceSchema, Errors } from "moleculer";
import type { DbAdapter, DbServiceSettings, MoleculerDbMethods } from "moleculer-db";
import type MongoDbAdapter from "moleculer-db-adapter-mongo";
import type { DbServiceMethods } from "../mixins/db.mixin";
import DbMixin from "../mixins/db.mixin";

const { MoleculerClientError, ValidationError } = Errors;

export interface MessageEntity {
	_id: string;
	title: string;
	description: string;
	quantity: number;
}

interface Meta {
	user?: MessageEntity | null | undefined;
}

export type ActionCreateParams = Partial<MessageEntity>;

export interface ActionQuantityParams {
	id: string;
	value: number;
	channel: any;
	creator: string;
	limit: any;
	offset: any;
	topic: any;
	message: any;
}

interface MessageSettings extends DbServiceSettings {
	indexes?: Record<string, number>[];
}

interface MessageThis extends Service<MessageSettings>, MoleculerDbMethods {
	adapter: DbAdapter | MongoDbAdapter;
}

const MessageService: ServiceSchema<MessageSettings> & { methods: DbServiceMethods } = {
	name: "messages",
	// version: 1

	/**
	 * Mixins
	 */
	mixins: [DbMixin("messages")],

	/**
	 * Settings
	 */
	settings: {
		// Available fields in the responses
		fields: ["_id", "message", "createdAt", "updatedAt", "creator", "topic"],

		// Validator for the `create` & `insert` actions.
		entityValidator: {
			title: "string|min:3",
			description: "string|min:3",
		},

		populates: {
			creator: {
				action: "users.get",
				params: {
					fields: ["_id", "username", "bio", "image"],
				},
			},
		},

		indexes: [{ name: 1 }],
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
			auth: "required",
			params: {
				topic: { type: "string" },
				message: { type: "object" },
			},
			handler(this: MessageThis, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				let entity = ctx.params.message;
				entity.topic = ctx.params.topic;
				const { user } = ctx.meta;
				entity.creator = user?._id.toString();

				return this.validateEntity(entity).then(() => {
					entity.createdAt = new Date();
					entity.updatedAt = new Date();

					return this.adapter
						.insert(entity)
						.then((doc) => this.transformDocuments(ctx, { populate: ["creator"] }, doc))
						.then((entity) => this.transformResult(ctx, entity, ctx.meta.user))
						.then((json) => this.entityChanged("created", json, ctx).then(() => json));
				});
			},
		},

		/**
		 * List articles with pagination.
		 *
		 * @actions
		 * @param {String} tag - Filter for 'tag'
		 * @param {String} author - Filter for author ID
		 * @param {String} favorited - Filter for favorited author
		 * @param {Number} limit - Pagination limit
		 * @param {Number} offset - Pagination offset
		 *
		 * @returns {Object} List of articles
		 */
		list: {
			cache: {
				keys: ["#token", "creator", "limit", "offset"],
			},
			params: {
				creator: { type: "string", optional: true },
				limit: { type: "number", optional: true, convert: true },
				offset: { type: "number", optional: true, convert: true },
			},
			handler(this: any, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				const limit = ctx.params.limit ? Number(ctx.params.limit) : 20;
				const offset = ctx.params.offset ? Number(ctx.params.offset) : 0;

				let params: any = {
					limit,
					offset,
					sort: ["-createdAt"],
					populate: ["creater"],
					query: {},
				};
				let countParams: any;

				console.log("***********");
				console.log("***********");
				console.log("***********, ctx.params.creator");
				console.log(ctx.params.creator);
				console.log("***********, ctx.entity");
				return this.Promise.resolve()
					.then(() => {
						if (ctx.params.creator) {
							return ctx
								.call("users.find", { query: { username: ctx.params.creator } })
								.then((channels: any) => {
									console.log("***********");
									console.log("***********");
									console.log("***********, channels");
									console.log(channels);
									console.log("***********, ctx.entity");
									if (channels.length == 0)
										return this.Promise.reject(
											new MoleculerClientError("Creator not found"),
										);

									params.query.creator = channels[0]._id;
								});
						}
					})
					.then(() => {
						countParams = Object.assign({}, params);
						// Remove pagination params
						if (countParams && countParams.limit) countParams.limit = null;
						if (countParams && countParams.offset) countParams.offset = null;
					})
					.then(() => {
						return this.Promise.all([
							// Get rows
							this.adapter.find(params),

							// Get count of all rows
							this.adapter.count(countParams),
						]);
					})
					.then((res: any) => {
						console.log("***********");
						console.log("***********");
						console.log("***********, channels");
						console.log(res);
						console.log(params);
						console.log("***********, ctx.entity");
						return this.transformDocuments(ctx, params, res[0])
							.then((docs: any) => this.transformResult(ctx, docs, ctx.meta.user))
							.then((r: any) => {
								r.count = res[1];
								return r;
							});
					});
			},
		},

		/**
		 * Get an article by slug
		 *
		 * @actions
		 * @param {String} id - Article slug
		 *
		 * @returns {Object} Article entity
		 */
		get: {
			cache: {
				keys: ["#token", "id"],
			},
			params: {
				id: { type: "string" },
			},
			handler(this: any, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				console.log("***********");
				console.log("***********, get");
				console.log("***********, ctx.meta");
				console.log(ctx.meta);
				console.log("***********, ctx.params");
				console.log(ctx.params);
				return this.findBySlug(ctx.params.id)
					.then((entity: any) => {
						if (!entity)
							return this.Promise.reject(
								new MoleculerClientError("Article not found!", 404),
							);

						return entity;
					})
					.then((doc: any) =>
						this.transformDocuments(ctx, { populate: ["creator"] }, doc),
					)
					.then((entity: any) => this.transformResult(ctx, entity, ctx.meta.user));
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
			async handler(this: MessageThis, ctx: Context<ActionQuantityParams>): Promise<object> {
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
			async handler(this: MessageThis, ctx: Context<ActionQuantityParams>): Promise<object> {
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
		 * Find an channel by slug
		 *
		 * @param {String} slug - Channel slug
		 *
		 * @results {Object} Promise<Article
		 */
		findBySlug(slug) {
			return this.adapter.findOne({ slug });
		},

		/**
		 *
		 * @param {Context} ctx
		 * @param {Array} entities
		 * @param {Object} user - Logged in user
		 */
		transformResult(this: any, ctx, entities, user) {
			if (Array.isArray(entities)) {
				return this.Promise.mapSeries(entities, (item: any) =>
					this.transformEntity(ctx, item, user),
				).then((channels: any) => ({ channels }));
			} else {
				return this.transformEntity(ctx, entities, user).then((article: any) => ({
					article,
				}));
			}
		},
		/**
		 *
		 * @param {Context} ctx
		 * @param {Object} entity
		 * @param {Object} user - Logged in user
		 */
		transformEntity(ctx, entity, user) {
			if (!entity) return Promise.resolve();
			return Promise.resolve(entity);
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

export default MessageService;
