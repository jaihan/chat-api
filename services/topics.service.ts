import { Context, Service, ServiceSchema, Errors } from "moleculer";
import type { DbAdapter, DbServiceSettings, MoleculerDbMethods } from "moleculer-db";
import type MongoDbAdapter from "moleculer-db-adapter-mongo";
import slug from "slug";
import type { DbServiceMethods } from "../mixins/db.mixin";
import DbMixin from "../mixins/db.mixin";

const { MoleculerClientError, ValidationError } = Errors;

export interface ChannelEntity {
	_id: string;
	title: string;
	description: string;
	quantity: number;
}

interface Meta {
	user?: ChannelEntity | null | undefined;
}

export type ActionCreateParams = Partial<ChannelEntity>;

export interface ActionQuantityParams {
	id: string;
	value: number;
	channel: any;
	creator: string;
	limit: any;
	offset: any;
	topic: any;
	slug: any;
	message: any;
}

interface ChannelSettings extends DbServiceSettings {
	indexes?: Record<string, number>[];
}

interface ChannelThis extends Service<ChannelSettings>, MoleculerDbMethods {
	adapter: DbAdapter | MongoDbAdapter;
}

const TopicService: ServiceSchema<ChannelSettings> & { methods: DbServiceMethods } = {
	name: "topics",
	// version: 1

	/**
	 * Mixins
	 */
	mixins: [DbMixin("topics")],

	/**
	 * Settings
	 */
	settings: {
		// Available fields in the responses
		fields: ["_id", "title", "slug", "description", "createdAt", "updatedAt", "creator"],

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
				channel: { type: "string" },
				topic: { type: "object" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				let entity = ctx.params.topic;
				entity.channel = ctx.params.channel;
				const { user } = ctx.meta;
				entity.creator = user?._id.toString();

				return this.validateEntity(entity).then(() => {
					entity.slug =
						slug(entity.title, { lower: true }) +
						"-" +
						((Math.random() * Math.pow(36, 6)) | 0).toString(36);
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
		 * Add a new comment to an article.
		 * Auth is required!
		 *
		 * @actions
		 * @param {String} slug - Article slug
		 * @param {Object} comment - Comment fields
		 *
		 * @returns {Object} Comment entity
		 */
		addMessage: {
			auth: "required",
			params: {
				slug: { type: "string" },
				message: { type: "object" },
			},
			handler(this: any, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				return this.Promise.resolve(ctx.params.slug)
					.then((slug: string) => this.findBySlug(slug))
					.then((topic: any) => {
						if (!topic)
							return this.Promise.reject(
								new MoleculerClientError("Article not found", 404),
							);

						return ctx.call("messages.create", {
							topic: topic._id.toString(),
							message: ctx.params.message,
						});
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
		 * Find an article by slug
		 *
		 * @param {String} slug - Article slug
		 *
		 * @results {Object} Promise<Article
		 */
		findBySlug(slug) {
			return this.adapter.findOne({ slug });
		},

		/**
		 * Transform the result entities to follow the RealWorld API spec
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
		 * Transform a result entity to follow the RealWorld API spec
		 *
		 * @param {Context} ctx
		 * @param {Object} entity
		 * @param {Object} user - Logged in user
		 */
		transformEntity(this: any, ctx, entity, user) {
			if (!entity) return this.Promise.resolve();

			return this.Promise.resolve(entity);
		},

		// async myAsyncFunction() {
		// 	const myArray: any = Promise;
		// 	const mappedArray = myArray.map((item: any) => item.property);
		// 	return mappedArray;
		// },
	},

	/**
	 * Fired after database connection establishing.
	 */
	async afterConnected(this: any) {
		if ("collection" in this.adapter) {
			if (this.settings.indexes) {
				await this.Promise.all(
					this.settings.indexes.map((index: any) =>
						(<MongoDbAdapter>this.adapter).collection.createIndex(index),
					),
				);
			}
		}
	},

	events: {
		"cache.clean.articles"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.users"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.comments"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.follows"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.favorites"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
	},
};

export default TopicService;
