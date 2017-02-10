/*global define*/
define([
        '../Core/BoundingSphere',
        '../Core/Cartesian3',
        '../Core/clone',
        '../Core/Color',
        '../Core/ComponentDatatype',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/Math',
        '../Core/Matrix4',
        '../Core/oneTimeWarning',
        '../Core/PrimitiveType',
        '../Renderer/Buffer',
        '../Renderer/BufferUsage',
        '../Renderer/DrawCommand',
        '../Renderer/ShaderSource',
        '../ThirdParty/when',
        './getAttributeOrUniformBySemantic',
        './Model',
        './ModelInstance',
        './SceneMode',
        './ShadowMode'
    ], function(
        BoundingSphere,
        Cartesian3,
        clone,
        Color,
        ComponentDatatype,
        defaultValue,
        defined,
        defineProperties,
        destroyObject,
        DeveloperError,
        CesiumMath,
        Matrix4,
        oneTimeWarning,
        PrimitiveType,
        Buffer,
        BufferUsage,
        DrawCommand,
        ShaderSource,
        when,
        getAttributeOrUniformBySemantic,
        Model,
        ModelInstance,
        SceneMode,
        ShadowMode) {
    'use strict';

    var LoadState = {
        NEEDS_LOAD : 0,
        LOADING : 1,
        LOADED : 2,
        FAILED : 3
    };

    /**
     * A 3D model instance collection. All instances reference the same underlying model, but have unique
     * per-instance properties like model matrix, pick id, etc.
     *
     * @alias ModelInstanceCollection
     * @constructor
     *
     * @param {Object} options Object with the following properties:
     * @param {Object[]} [options.instances] An array of instances, where each instance contains a modelMatrix and optional batchId when options.batchTable is defined.
     * @param {Cesium3DTileBatchTable} [options.batchTable] The batch table of the instanced 3D Tile.
     * @param {Object} [options.boundingVolume] The bounding volume, typically the bounding volume of the instanced 3D Tile.
     * @param {Cartesian3} [options.center] The center point of the instances, typically only passed in by the instanced 3D Tile.
     * @param {Matrix4} [options.transform=Matrix4.IDENTITY] An additional transform to apply to all instances, typically the transform of the 3D Tile.
     * @param {String} [options.url] The url to the .gltf file.
     * @param {Object} [options.headers] HTTP headers to send with the request.
     * @param {Object} [options.requestType] The request type, used for budget scheduling in {@link RequestScheduler}.
     * @param {Object|ArrayBuffer|Uint8Array} [options.gltf] The object for the glTF JSON or an arraybuffer of Binary glTF defined by the CESIUM_binary_glTF extension.
     * @param {String} [options.basePath=''] The base path that paths in the glTF JSON are relative to.
     * @param {Boolean} [options.dynamic=false] Hint if instance model matrices will be updated frequently.
     * @param {Boolean} [options.show=true] Determines if the collection will be shown.
     * @param {Boolean} [options.allowPicking=true] When <code>true</code>, each instance is pickable with {@link Scene#pick}.
     * @param {Boolean} [options.asynchronous=true] Determines if model WebGL resource creation will be spread out over several frames or block until completion once all glTF files are loaded.
     * @param {Boolean} [options.incrementallyLoadTextures=true] Determine if textures may continue to stream in after the model is loaded.
     * @param {ShadowMode} [options.shadows=ShadowMode.ENABLED] Determines whether the collection casts or receives shadows from each light source.
     * @param {Boolean} [options.debugShowBoundingVolume=false] For debugging only. Draws the bounding sphere for the collection.
     * @param {Boolean} [options.debugWireframe=false] For debugging only. Draws the instances in wireframe.
     *
     * @exception {DeveloperError} Must specify either <options.gltf> or <options.url>, but not both.
     * @exception {DeveloperError} Shader program cannot be optimized for instancing. Parameters cannot have any of the following semantics: MODEL, MODELINVERSE, MODELVIEWINVERSE, MODELVIEWPROJECTIONINVERSE, MODELINVERSETRANSPOSE.
     *
     * @private
     */
    function ModelInstanceCollection(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        //>>includeStart('debug', pragmas.debug);
        if (!defined(options.gltf) && !defined(options.url)) {
            throw new DeveloperError('Either options.gltf or options.url is required.');
        }

        if (defined(options.gltf) && defined(options.url)) {
            throw new DeveloperError('Cannot pass in both options.gltf and options.url.');
        }
        //>>includeEnd('debug');

        this.show = defaultValue(options.show, true);

        this._instancingSupported = false;
        this._dynamic = defaultValue(options.dynamic, false);
        this._allowPicking = defaultValue(options.allowPicking, true);
        this._cull = defaultValue(options.cull, true);
        this._ready = false;
        this._readyPromise = when.defer();
        this._state = LoadState.NEEDS_LOAD;
        this._dirty = false;

        this._instances = createInstances(this, options.instances);

        // When the model instance collection is backed by an instanced 3d-tile,
        // use its batch table resources to modify the shaders, attributes, and uniform maps.
        this._batchTable = options.batchTable;

        this._model = undefined;
        this._vertexBufferData = undefined; // Hold onto the vertex buffer data when dynamic is true
        this._vertexBuffer = undefined;
        this._batchIdBuffer = undefined;
        this._instancedUniformsByProgram = undefined;

        this._drawCommands = [];
        this._pickCommands = [];
        this._modelCommands = undefined;

        this._boundingVolume = defined(options.boundingVolume) ? options.boundingVolume : createBoundingSphere(this);
        this._boundingVolumeExpand = !defined(options.boundingVolume); // Expand the bounding volume by the radius of the loaded model

        this._center = defaultValue(options.center, this._boundingVolume.center);
        this.transform = defined(options.transform) ? options.transform : Matrix4.clone(Matrix4.IDENTITY);
        this._rtcViewTransform = new Matrix4(); // Holds onto uniform

        // Passed on to Model
        this._url = options.url;
        this._headers = options.headers;
        this._requestType = options.requestType;
        this._gltf = options.gltf;
        this._basePath = options.basePath;
        this._asynchronous = options.asynchronous;
        this._incrementallyLoadTextures = options.incrementallyLoadTextures;

        this.shadows = defaultValue(options.shadows, ShadowMode.ENABLED);
        this._shadows = this.shadows;

        this.debugShowBoundingVolume = defaultValue(options.debugShowBoundingVolume, false);
        this._debugShowBoundingVolume = false;

        this.debugWireframe = defaultValue(options.debugWireframe, false);
        this._debugWireframe = false;
    }

    defineProperties(ModelInstanceCollection.prototype, {
        allowPicking : {
            get : function() {
                return this._allowPicking;
            }
        },
        length : {
            get : function() {
                return this._instances.length;
            }
        },
        activeAnimations : {
            get : function() {
                return this._model.activeAnimations;
            }
        },
        ready : {
            get : function() {
                return this._ready;
            }
        },
        readyPromise : {
            get : function() {
                return this._readyPromise.promise;
            }
        }
    });

    function createInstances(collection, instancesOptions) {
        instancesOptions = defaultValue(instancesOptions, []);
        var length = instancesOptions.length;
        var instances = new Array(length);
        for (var i = 0; i < length; ++i) {
            var instanceOptions = instancesOptions[i];
            var modelMatrix = instanceOptions.modelMatrix;
            var instanceId = defaultValue(instanceOptions.batchId, i);
            instances[i] = new ModelInstance(collection, modelMatrix, instanceId);
        }
        return instances;
    }

    function createBoundingSphere(collection) {
        var instancesLength = collection.length;
        var points = new Array(instancesLength);
        for (var i = 0; i < instancesLength; ++i) {
            points[i] = Matrix4.getTranslation(collection._instances[i]._modelMatrix, new Cartesian3());
        }

        return BoundingSphere.fromPoints(points);
    }

    var scratchCartesian = new Cartesian3();

    ModelInstanceCollection.prototype.expandBoundingSphere = function(instanceModelMatrix) {
        if (this._boundingVolumeExpand) {
            var translation = Matrix4.getTranslation(instanceModelMatrix, scratchCartesian);
            BoundingSphere.expand(this._boundingVolume, translation, this._boundingVolume);
        }
    };

    function getInstancedUniforms(collection, programName) {
        if (defined(collection._instancedUniformsByProgram)) {
            return collection._instancedUniformsByProgram[programName];
        }

        var instancedUniformsByProgram = {};
        collection._instancedUniformsByProgram = instancedUniformsByProgram;

        // When using CESIUM_RTC_MODELVIEW the CESIUM_RTC center is ignored. Instances are always rendered relative-to-center.
        var modelSemantics = ['MODEL', 'MODELVIEW', 'CESIUM_RTC_MODELVIEW', 'MODELVIEWPROJECTION', 'MODELINVERSE', 'MODELVIEWINVERSE', 'MODELVIEWPROJECTIONINVERSE', 'MODELINVERSETRANSPOSE', 'MODELVIEWINVERSETRANSPOSE'];
        var supportedSemantics = ['MODELVIEW', 'CESIUM_RTC_MODELVIEW', 'MODELVIEWPROJECTION', 'MODELVIEWINVERSETRANSPOSE'];

        var gltf = collection._model.gltf;
        var techniques = gltf.techniques;
        for (var techniqueName in techniques) {
            if (techniques.hasOwnProperty(techniqueName)) {
                var technique = techniques[techniqueName];
                var parameters = technique.parameters;
                var uniforms = technique.uniforms;
                var program = technique.program;

                // Different techniques may share the same program, skip if already processed.
                // This assumes techniques that share a program do not declare different semantics for the same uniforms.
                if (!defined(instancedUniformsByProgram[program])) {
                    var uniformMap = {};
                    instancedUniformsByProgram[program] = uniformMap;
                    for (var uniformName in uniforms) {
                        if (uniforms.hasOwnProperty(uniformName)) {
                            var parameterName = uniforms[uniformName];
                            var parameter = parameters[parameterName];
                            var semantic = parameter.semantic;
                            if (defined(semantic) && (modelSemantics.indexOf(semantic) > -1)) {
                                if (supportedSemantics.indexOf(semantic) > -1) {
                                    uniformMap[uniformName] = semantic;
                                } else {
                                    //>>includeStart('debug', pragmas.debug);
                                    throw new DeveloperError('Shader program cannot be optimized for instancing. ' +
                                        'Parameter "' + parameter + '" in program "' + programName +
                                        '" uses unsupported semantic "' + semantic + '"'
                                    );
                                    //>>includeEnd('debug');
                                }
                            }
                        }
                    }
                }
            }
        }

        return instancedUniformsByProgram[programName];
    }

    var vertexShaderCached;

    function getVertexShaderCallback(collection) {
        return function(vs, programName) {
            var instancedUniforms = getInstancedUniforms(collection, programName);
            var usesBatchTable = defined(collection._batchTable);

            var renamedSource = ShaderSource.replaceMain(vs, 'czm_instancing_main');

            var globalVarsHeader = '';
            var globalVarsMain = '';
            for (var uniform in instancedUniforms) {
                if (instancedUniforms.hasOwnProperty(uniform)) {
                    var semantic = instancedUniforms[uniform];
                    var varName;
                    if (semantic === 'MODELVIEW' || semantic === 'CESIUM_RTC_MODELVIEW') {
                        varName = 'czm_instanced_modelView';
                    } else if (semantic === 'MODELVIEWPROJECTION') {
                        varName = 'czm_instanced_modelViewProjection';
                        globalVarsHeader += 'mat4 czm_instanced_modelViewProjection;\n';
                        globalVarsMain += 'czm_instanced_modelViewProjection = czm_projection * czm_instanced_modelView;\n';
                    } else if (semantic === 'MODELVIEWINVERSETRANSPOSE') {
                        varName = 'czm_instanced_modelViewInverseTranspose';
                        globalVarsHeader += 'mat3 czm_instanced_modelViewInverseTranspose;\n';
                        globalVarsMain += 'czm_instanced_modelViewInverseTranspose = mat3(czm_instanced_modelView);\n';
                    }

                    // Remove the uniform declaration
                    var regex = new RegExp('uniform.*' + uniform + '.*');
                    renamedSource = renamedSource.replace(regex, '');

                    // Replace all occurrences of the uniform with the global variable
                    regex = new RegExp(uniform + '\\b', 'g');
                    renamedSource = renamedSource.replace(regex, varName);
                }
            }

            // czm_instanced_model is the model matrix of the instance relative to center
            // czm_instanced_modifiedModelView is the transform from the center to view
            // czm_instanced_nodeTransform is the local offset of the node within the model
            var uniforms =
                'uniform mat4 czm_instanced_modifiedModelView;\n' +
                'uniform mat4 czm_instanced_nodeTransform;\n';

            var batchIdAttribute = usesBatchTable ? 'attribute float a_batchId;\n' : '';

            var instancedSource =
                uniforms +
                globalVarsHeader +
                'mat4 czm_instanced_modelView;\n' +
                'attribute vec4 czm_modelMatrixRow0;\n' +
                'attribute vec4 czm_modelMatrixRow1;\n' +
                'attribute vec4 czm_modelMatrixRow2;\n' +
                batchIdAttribute +
                renamedSource +
                'void main()\n' +
                '{\n' +
                '    mat4 czm_instanced_model = mat4(czm_modelMatrixRow0.x, czm_modelMatrixRow1.x, czm_modelMatrixRow2.x, 0.0, czm_modelMatrixRow0.y, czm_modelMatrixRow1.y, czm_modelMatrixRow2.y, 0.0, czm_modelMatrixRow0.z, czm_modelMatrixRow1.z, czm_modelMatrixRow2.z, 0.0, czm_modelMatrixRow0.w, czm_modelMatrixRow1.w, czm_modelMatrixRow2.w, 1.0);\n' +
                '    czm_instanced_modelView = czm_instanced_modifiedModelView * czm_instanced_model * czm_instanced_nodeTransform;\n' +
                     globalVarsMain +
                '    czm_instancing_main();\n' +
                '}';

            vertexShaderCached = instancedSource;

            if (usesBatchTable) {
                instancedSource = collection._batchTable.getVertexShaderCallback(true, 'a_batchId')(instancedSource);
            }

            return instancedSource;
        };
    }

    function getFragmentShaderCallback(collection) {
        return function(fs) {
            var batchTable = collection._batchTable;
            if (defined(batchTable)) {
                var gltf = collection._model.gltf;
                var diffuseUniformName = getAttributeOrUniformBySemantic(gltf, '_3DTILESDIFFUSE');
                var colorBlendMode = batchTable._content._tileset.colorBlendMode;
                fs = batchTable.getFragmentShaderCallback(true, colorBlendMode, diffuseUniformName)(fs);
            }
            return fs;
        };
    }

    function getPickVertexShaderCallback(collection) {
        return function (vs) {
            // Use the vertex shader that was generated earlier
            vs = vertexShaderCached;
            var usesBatchTable = defined(collection._batchTable);
            var allowPicking = collection._allowPicking;
            if (usesBatchTable) {
                vs = collection._batchTable.getPickVertexShaderCallback('a_batchId')(vs);
            } else if (allowPicking) {
                vs = ShaderSource.createPickVertexShaderSource(vs);
            }
            return vs;
        };
    }

    function getPickFragmentShaderCallback(collection) {
        return function(fs) {
            var usesBatchTable = defined(collection._batchTable);
            var allowPicking = collection._allowPicking;
            if (usesBatchTable) {
                fs = collection._batchTable.getPickFragmentShaderCallback()(fs);
            } else if (allowPicking) {
                fs = ShaderSource.createPickFragmentShaderSource(fs, 'varying');
            }
            return fs;
        };
    }

    function createModifiedModelView(collection, context) {
        return function() {
            var rtcTransform = Matrix4.multiplyByTranslation(collection.transform, collection._center, scratchMatrix);
            return Matrix4.multiply(context.uniformState.view, rtcTransform, collection._rtcViewTransform);
        };
    }

    function createNodeTransformFunction(node) {
        return function() {
            return node.computedMatrix;
        };
    }

    function getUniformMapCallback(collection, context) {
        return function(uniformMap, programName, node) {
            uniformMap = clone(uniformMap);
            uniformMap.czm_instanced_modifiedModelView = createModifiedModelView(collection, context);
            uniformMap.czm_instanced_nodeTransform = createNodeTransformFunction(node);

            // Remove instanced uniforms from the uniform map
            var instancedUniforms = getInstancedUniforms(collection, programName);
            for (var uniform in instancedUniforms) {
                if (instancedUniforms.hasOwnProperty(uniform)) {
                    delete uniformMap[uniform];
                }
            }

            if (defined(collection._batchTable)) {
                uniformMap = collection._batchTable.getUniformMapCallback()(uniformMap);
            }

            return uniformMap;
        };
    }

    function getPickUniformMapCallback(collection) {
        return function(uniformMap) {
            // Uses the uniform map generated from getUniformMapCallback
            if (defined(collection._batchTable)) {
                uniformMap = collection._batchTable.getPickUniformMapCallback()(uniformMap);
            }
            return uniformMap;
        };
    }

    function getVertexShaderNonInstancedCallback(collection) {
        return function(vs) {
            if (defined(collection._batchTable)) {
                vs = collection._batchTable.getVertexShaderCallback(true, 'a_batchId')(vs);
                // Treat a_batchId as a uniform rather than a vertex attribute
                vs = 'uniform float a_batchId\n;' + vs;
            }
            return vs;
        };
    }

    function getPickVertexShaderNonInstancedCallback(collection) {
        return function(vs) {
            if (defined(collection._batchTable)) {
                vs = collection._batchTable.getPickVertexShaderCallback('a_batchId')(vs);
                // Treat a_batchId as a uniform rather than a vertex attribute
                vs = 'uniform float a_batchId\n;' + vs;
            }
            return vs;
        };
    }

    function getPickFragmentShaderNonInstancedCallback(collection) {
        return function(fs) {
            var usesBatchTable = defined(collection._batchTable);
            var allowPicking = collection._allowPicking;
            if (usesBatchTable) {
                fs = collection._batchTable.getPickFragmentShaderCallback()(fs);
            } else if (allowPicking) {
                fs = ShaderSource.createPickFragmentShaderSource(fs, 'uniform');
            }
            return fs;
        };
    }

    function getUniformMapNonInstancedCallback(collection) {
        return function(uniformMap) {
            if (defined(collection._batchTable)) {
                uniformMap = collection._batchTable.getUniformMapCallback()(uniformMap);
            }

            return uniformMap;
        };
    }

    var scratchMatrix = new Matrix4();

    function getVertexBufferData(collection, context) {
        var instances = collection._instances;
        var instancesLength = collection.length;
        var collectionCenter = collection._center;
        var vertexSizeInFloats = 12;

        var bufferData = collection._vertexBufferData;
        if (!defined(bufferData)) {
            bufferData = new Float32Array(instancesLength * vertexSizeInFloats);
        }
        if (collection._dynamic) {
            // Hold onto the buffer data so we don't have to allocate new memory every frame.
            collection._vertexBufferData = bufferData;
        }

        for (var i = 0; i < instancesLength; ++i) {
            var modelMatrix = instances[i]._modelMatrix;

            // Instance matrix is relative to center
            var instanceMatrix = Matrix4.clone(modelMatrix, scratchMatrix);
            instanceMatrix[12] -= collectionCenter.x;
            instanceMatrix[13] -= collectionCenter.y;
            instanceMatrix[14] -= collectionCenter.z;

            var offset = i * vertexSizeInFloats;

            // First three rows of the model matrix
            bufferData[offset + 0]  = instanceMatrix[0];
            bufferData[offset + 1]  = instanceMatrix[4];
            bufferData[offset + 2]  = instanceMatrix[8];
            bufferData[offset + 3]  = instanceMatrix[12];
            bufferData[offset + 4]  = instanceMatrix[1];
            bufferData[offset + 5]  = instanceMatrix[5];
            bufferData[offset + 6]  = instanceMatrix[9];
            bufferData[offset + 7]  = instanceMatrix[13];
            bufferData[offset + 8]  = instanceMatrix[2];
            bufferData[offset + 9]  = instanceMatrix[6];
            bufferData[offset + 10] = instanceMatrix[10];
            bufferData[offset + 11] = instanceMatrix[14];
        }

        return bufferData;
    }

    function createVertexBuffer(collection, context) {
        var i;
        var instances = collection._instances;
        var instancesLength = collection.length;
        var dynamic = collection._dynamic;
        var usesBatchTable = defined(collection._batchTable);
        var allowPicking = collection._allowPicking;

        if (usesBatchTable) {
            var batchIdBufferData = new Uint16Array(instancesLength);
            for (i = 0; i < instancesLength; ++i) {
                batchIdBufferData[i] = instances[i]._instanceId;
            }
            collection._batchIdBuffer = Buffer.createVertexBuffer({
                context : context,
                typedArray : batchIdBufferData,
                usage : BufferUsage.STATIC_DRAW
            });
        }

        if (allowPicking && !usesBatchTable) {
            var pickIdBuffer = new Uint8Array(instancesLength * 4);
            for (i = 0; i < instancesLength; ++i) {
                var pickId = collection._pickIds[i];
                var pickColor = pickId.color;
                var offset = i * 4;
                pickIdBuffer[offset] = Color.floatToByte(pickColor.red);
                pickIdBuffer[offset + 1] = Color.floatToByte(pickColor.green);
                pickIdBuffer[offset + 2] = Color.floatToByte(pickColor.blue);
                pickIdBuffer[offset + 3] = Color.floatToByte(pickColor.alpha);
            }
            collection._pickIdBuffer = Buffer.createVertexBuffer({
                context : context,
                typedArray : pickIdBuffer,
                usage : BufferUsage.STATIC_DRAW
            });
        }

        var vertexBufferData = getVertexBufferData(collection, context);
        collection._vertexBuffer = Buffer.createVertexBuffer({
            context : context,
            typedArray : vertexBufferData,
            usage : dynamic ? BufferUsage.STREAM_DRAW : BufferUsage.STATIC_DRAW
        });
    }

    function updateVertexBuffer(collection, context) {
        var vertexBufferData = getVertexBufferData(collection, context);
        collection._vertexBuffer.copyFromArrayView(vertexBufferData);
    }

    function createPickIds(collection, context) {
        // PERFORMANCE_IDEA: we could skip the pick buffer completely by allocating
        // a continuous range of pickIds and then converting the base pickId + batchId
        // to RGBA in the shader.  The only consider is precision issues, which might
        // not be an issue in WebGL 2.
        var instances = collection._instances;
        var instancesLength = instances.length;
        var pickIds = new Array(instancesLength);
        for (var i = 0; i < instancesLength; ++i) {
            pickIds[i] = context.createPickId(instances[i]);
        }
        return pickIds;
    }

    function createModel(collection, context) {
        var instancingSupported = collection._instancingSupported;
        var usesBatchTable = defined(collection._batchTable);
        var allowPicking = collection._allowPicking;

        var modelOptions = {
            url : collection._url,
            headers : collection._headers,
            requestType : collection._requestType,
            gltf : collection._gltf,
            basePath : collection._basePath,
            shadows : collection._shadows,
            cacheKey : undefined,
            asynchronous : collection._asynchronous,
            allowPicking : allowPicking,
            incrementallyLoadTextures : collection._incrementallyLoadTextures,
            precreatedAttributes : undefined,
            vertexShaderLoaded : undefined,
            fragmentShaderLoaded : undefined,
            uniformMapLoaded : undefined,
            pickVertexShaderLoaded : undefined,
            pickFragmentShaderLoaded : undefined,
            pickUniformMapLoaded : undefined,
            ignoreCommands : true
        };

        if (allowPicking && !usesBatchTable) {
            collection._pickIds = createPickIds(collection, context);
        }

        if (instancingSupported) {
            createVertexBuffer(collection, context);

            var vertexSizeInFloats = 12;
            var componentSizeInBytes = ComponentDatatype.getSizeInBytes(ComponentDatatype.FLOAT);

            var instancedAttributes = {
                czm_modelMatrixRow0 : {
                    index                  : 0, // updated in Model
                    vertexBuffer           : collection._vertexBuffer,
                    componentsPerAttribute : 4,
                    componentDatatype      : ComponentDatatype.FLOAT,
                    normalize              : false,
                    offsetInBytes          : 0,
                    strideInBytes          : componentSizeInBytes * vertexSizeInFloats,
                    instanceDivisor        : 1
                },
                czm_modelMatrixRow1 : {
                    index                  : 0, // updated in Model
                    vertexBuffer           : collection._vertexBuffer,
                    componentsPerAttribute : 4,
                    componentDatatype      : ComponentDatatype.FLOAT,
                    normalize              : false,
                    offsetInBytes          : componentSizeInBytes * 4,
                    strideInBytes          : componentSizeInBytes * vertexSizeInFloats,
                    instanceDivisor        : 1
                },
                czm_modelMatrixRow2 : {
                    index                  : 0, // updated in Model
                    vertexBuffer           : collection._vertexBuffer,
                    componentsPerAttribute : 4,
                    componentDatatype      : ComponentDatatype.FLOAT,
                    normalize              : false,
                    offsetInBytes          : componentSizeInBytes * 8,
                    strideInBytes          : componentSizeInBytes * vertexSizeInFloats,
                    instanceDivisor        : 1
                }
            };

            // When using a batch table, add a batch id attribute
            if (usesBatchTable) {
                instancedAttributes.a_batchId = {
                    index                   : 0, // updated in Model
                    vertexBuffer            : collection._batchIdBuffer,
                    componentsPerAttribute  : 1,
                    componentDatatype       : ComponentDatatype.UNSIGNED_SHORT,
                    normalize               : false,
                    offsetInBytes           : 0,
                    strideInBytes           : 0,
                    instanceDivisor         : 1
                };
            }

            if (allowPicking && !usesBatchTable) {
                instancedAttributes.pickColor = {
                    index : 0, // updated in Model
                    vertexBuffer            : collection._pickIdBuffer,
                    componentsPerAttribute  : 4,
                    componentDatatype       : ComponentDatatype.UNSIGNED_BYTE,
                    normalize               : true,
                    offsetInBytes           : 0,
                    strideInBytes           : 0,
                    instanceDivisor         : 1
                };
            }

            modelOptions.precreatedAttributes = instancedAttributes;
            modelOptions.vertexShaderLoaded = getVertexShaderCallback(collection);
            modelOptions.fragmentShaderLoaded = getFragmentShaderCallback(collection);
            modelOptions.uniformMapLoaded = getUniformMapCallback(collection, context);
            modelOptions.pickVertexShaderLoaded = getPickVertexShaderCallback(collection);
            modelOptions.pickFragmentShaderLoaded = getPickFragmentShaderCallback(collection);
            modelOptions.pickUniformMapLoaded = getPickUniformMapCallback(collection);

            if (defined(collection._url)) {
                modelOptions.cacheKey = collection._url + '#instanced';
            }
        } else {
            modelOptions.vertexShaderLoaded = getVertexShaderNonInstancedCallback(collection);
            modelOptions.fragmentShaderLoaded = getFragmentShaderCallback(collection);
            modelOptions.uniformMapLoaded = getUniformMapNonInstancedCallback(collection, context);
            modelOptions.pickVertexShaderLoaded = getPickVertexShaderNonInstancedCallback(collection);
            modelOptions.pickFragmentShaderLoaded = getPickFragmentShaderNonInstancedCallback(collection);
            modelOptions.pickUniformMapLoaded = getPickUniformMapCallback(collection);
        }

        if (defined(collection._url)) {
            collection._model = Model.fromGltf(modelOptions);
        } else {
            collection._model = new Model(modelOptions);
        }
    }

    function updateWireframe(collection) {
        if (collection._debugWireframe !== collection.debugWireframe) {
            collection._debugWireframe = collection.debugWireframe;

            // This assumes the original primitive was TRIANGLES and that the triangles
            // are connected for the wireframe to look perfect.
            var primitiveType = collection.debugWireframe ? PrimitiveType.LINES : PrimitiveType.TRIANGLES;
            var commands = collection._drawCommands;
            var length = commands.length;
            for (var i = 0; i < length; ++i) {
                commands[i].primitiveType = primitiveType;
            }
        }
    }
    function updateShowBoundingVolume(collection) {
        if (collection.debugShowBoundingVolume !== collection._debugShowBoundingVolume) {
            collection._debugShowBoundingVolume = collection.debugShowBoundingVolume;

            var commands = collection._drawCommands;
            var length = commands.length;
            for (var i = 0; i < length; ++i) {
                commands[i].debugShowBoundingVolume = collection.debugShowBoundingVolume;
            }
        }
    }

    function createCommands(collection, drawCommands, pickCommands) {
        var commandsLength = drawCommands.length;
        var instancesLength = collection.length;
        var allowPicking = collection.allowPicking;
        var boundingVolume = collection._boundingVolume;
        var cull = collection._cull;

        for (var i = 0; i < commandsLength; ++i) {
            var drawCommand = DrawCommand.shallowClone(drawCommands[i]);
            drawCommand.instanceCount = instancesLength;
            drawCommand.boundingVolume = boundingVolume;
            drawCommand.cull = cull;
            collection._drawCommands.push(drawCommand);

            if (allowPicking) {
                var pickCommand = DrawCommand.shallowClone(pickCommands[i]);
                pickCommand.instanceCount = instancesLength;
                pickCommand.boundingVolume = boundingVolume;
                pickCommand.cull = cull;
                collection._pickCommands.push(pickCommand);
            }
        }
    }

    function createBatchIdFunction(batchId) {
        return function() {
            return batchId;
        };
    }

    function createPickColorFunction(color) {
        return function() {
            return color;
        };
    }

    function createCommandsNonInstanced(collection, drawCommands, pickCommands) {
        // When instancing is disabled, create commands for every instance.
        var instances = collection._instances;
        var commandsLength = drawCommands.length;
        var instancesLength = collection.length;
        var allowPicking = collection.allowPicking;
        var usesBatchTable = defined(collection._batchTable);
        var cull = collection._cull;

        for (var i = 0; i < commandsLength; ++i) {
            for (var j = 0; j < instancesLength; ++j) {
                var drawCommand = DrawCommand.shallowClone(drawCommands[i]);
                drawCommand.modelMatrix = new Matrix4(); // Updated in updateNonInstancedCommands
                drawCommand.boundingVolume = new BoundingSphere(); // Updated in updateNonInstancedCommands
                drawCommand.cull = cull;
                drawCommand.uniformMap = clone(drawCommand.uniformMap);
                if (usesBatchTable) {
                    drawCommand.uniformMap.a_batchId = createBatchIdFunction(instances[j]._instanceId);
                }
                collection._drawCommands.push(drawCommand);

                if (allowPicking) {
                    var pickCommand = DrawCommand.shallowClone(pickCommands[i]);
                    pickCommand.modelMatrix = new Matrix4(); // Updated in updateNonInstancedCommands
                    pickCommand.boundingVolume = new BoundingSphere(); // Updated in updateNonInstancedCommands
                    pickCommand.cull = cull;
                    pickCommand.uniformMap = clone(pickCommand.uniformMap);
                    if (usesBatchTable) {
                        pickCommand.uniformMap.a_batchId = createBatchIdFunction(instances[j]._instanceId);
                    } else if (allowPicking) {
                        var pickId = collection._pickIds[j];
                        pickCommand.uniformMap.czm_pickColor = createPickColorFunction(pickId.color);
                    }
                    collection._pickCommands.push(pickCommand);
                }
            }
        }
    }

    function updateCommandsNonInstanced(collection) {
        var modelCommands = collection._modelCommands;
        var commandsLength = modelCommands.length;
        var instancesLength = collection.length;
        var allowPicking = collection.allowPicking;

        for (var i = 0; i < commandsLength; ++i) {
            var modelCommand = modelCommands[i];
            for (var j = 0; j < instancesLength; ++j) {
                var commandIndex = i * instancesLength + j;
                var drawCommand = collection._drawCommands[commandIndex];
                var collectionTransform = collection.transform;
                var instanceMatrix = collection._instances[j]._modelMatrix;
                instanceMatrix = Matrix4.multiply(collectionTransform, instanceMatrix, scratchMatrix);
                var nodeMatrix = modelCommand.modelMatrix;
                var modelMatrix = drawCommand.modelMatrix;
                Matrix4.multiply(instanceMatrix, nodeMatrix, modelMatrix);

                var nodeBoundingSphere = modelCommand.boundingVolume;
                var boundingSphere = drawCommand.boundingVolume;
                BoundingSphere.transform(nodeBoundingSphere, instanceMatrix, boundingSphere);

                if (allowPicking) {
                    var pickCommand = collection._pickCommands[commandIndex];
                    Matrix4.clone(modelMatrix, pickCommand.modelMatrix);
                    BoundingSphere.clone(boundingSphere, pickCommand.boundingVolume);
                }
            }
        }
    }

    function getModelCommands(model) {
        var nodeCommands = model._nodeCommands;
        var length = nodeCommands.length;

        var drawCommands = [];
        var pickCommands = [];

        for (var i = 0; i < length; ++i) {
            var nc = nodeCommands[i];
            if (nc.show) {
                drawCommands.push(nc.command);
                pickCommands.push(nc.pickCommand);
            }
        }

        return {
            draw: drawCommands,
            pick: pickCommands
        };
    }

    function updateShadows(collection) {
        if (collection.shadows !== collection._shadows) {
            collection._shadows = collection.shadows;

            var castShadows = ShadowMode.castShadows(collection.shadows);
            var receiveShadows = ShadowMode.receiveShadows(collection.shadows);

            var drawCommands = collection._drawCommands;
            var length = drawCommands.length;
            for (var i = 0; i < length; ++i) {
                var drawCommand = drawCommands[i];
                drawCommand.castShadows = castShadows;
                drawCommand.receiveShadows = receiveShadows;
            }
        }
    }

    ModelInstanceCollection.prototype.update = function(frameState) {
        if (frameState.mode !== SceneMode.SCENE3D) {
            oneTimeWarning('Instanced models in 2D', 'Instanced models are only supported in 3D.');
            return;
        }

        if (!this.show) {
            return;
        }

        if (this.length === 0) {
            return;
        }

        var context = frameState.context;

        if (this._state === LoadState.NEEDS_LOAD) {
            this._state = LoadState.LOADING;
            this._instancingSupported = context.instancedArrays;
            createModel(this, context);
            var that = this;
            this._model.readyPromise.otherwise(function(error) {
                that._state = LoadState.FAILED;
                that._readyPromise.reject(error);
            });
        }

        var instancingSupported = this._instancingSupported;
        var model = this._model;
        model.update(frameState);

        if (model.ready && (this._state === LoadState.LOADING)) {
            this._state = LoadState.LOADED;
            this._ready = true;

            // Expand bounding volume to fit the radius of the loaded model
            if (this._boundingVolumeExpand) {
                this._boundingVolume.radius += model.boundingSphere.radius;
            }

            var modelCommands = getModelCommands(model);
            this._modelCommands = modelCommands.draw;

            if (instancingSupported) {
                createCommands(this, modelCommands.draw, modelCommands.pick);
            } else {
                createCommandsNonInstanced(this, modelCommands.draw, modelCommands.pick);
                updateCommandsNonInstanced(this);
            }

            this._readyPromise.resolve(this);
            return;
        }

        if (this._state !== LoadState.LOADED) {
            return;
        }

        // If any node changes due to an animation, update the commands. This could be inefficient if the model is
        // composed of many nodes and only one changes, however it is probably fine in the general use case.
        // Only applies when instancing is disabled. The instanced shader automatically handles node transformations.
        if (!instancingSupported && (model.dirty || this._dirty)) {
            updateCommandsNonInstanced(this);
        }

        if (instancingSupported && this._dirty) {
            // If at least one instance has moved assume the collection is now dynamic
            this._dynamic = true;
            this._dirty = false;

            // PERFORMANCE_IDEA: only update dirty sub-sections instead of the whole collection
            updateVertexBuffer(this, context);
        }

        updateShadows(this);
        updateWireframe(this);
        updateShowBoundingVolume(this);

        var passes = frameState.passes;
        var commands = passes.render ? this._drawCommands : this._pickCommands;
        var commandsLength = commands.length;

        for (var i = 0; i < commandsLength; ++i) {
            frameState.addCommand(commands[i]);
        }
    };

    ModelInstanceCollection.prototype.isDestroyed = function() {
        return false;
    };

    ModelInstanceCollection.prototype.destroy = function() {
        this._model = this._model && this._model.destroy();

        var pickIds = this._pickIds;
        if (defined(pickIds)) {
            var length = pickIds.length;
            for (var i = 0; i < length; ++i) {
                pickIds[i].destroy();
            }
        }

        return destroyObject(this);
    };

    return ModelInstanceCollection;
});