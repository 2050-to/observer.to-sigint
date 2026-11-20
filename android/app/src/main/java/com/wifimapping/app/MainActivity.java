package com.wifimapping.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WardrivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
