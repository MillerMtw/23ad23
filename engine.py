import Vykron
import threading
import time

if Vykron.current_model_name != Vykron.model.preset:
    Vykron.model.preset = Vykron.current_model_name
    Vykron.model._load()

if Vykron.current_profile != "Default":
    for preset in Vykron.CUSTOM_ONNX_PRESETS:
        if f"|{Vykron.current_profile}|" in preset and preset != Vykron.current_model_name:
            Vykron.set_model(Vykron._preset_name(preset))
            break
    else:
        if Vykron.CUSTOM_ONNX_PRESETS and Vykron.current_model_name not in Vykron.CUSTOM_ONNX_PRESETS:
            Vykron.set_model(Vykron._preset_name(Vykron.CUSTOM_ONNX_PRESETS[0]))

if Vykron.active:
    try:
        Vykron.init_virtual_ctrl()
    except:
        pass

threading.Thread(target=Vykron.detection_loop, daemon=True).start()
threading.Thread(target=Vykron.aim_loop, daemon=True).start()
threading.Thread(target=Vykron.sync_loop, daemon=True).start()
Vykron.start_instant_listener(5001)

try:
    while True:
        time.sleep(1)
except:
    pass
